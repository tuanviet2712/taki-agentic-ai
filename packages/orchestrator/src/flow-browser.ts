import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { AppError, logger } from "@dotaka/shared";
import { chromeChannel, listChromeProfiles } from "./chrome-profiles.ts";

/**
 * "Chrome Flow": a dedicated Chrome instance (own user-data-dir, DevTools port) that the Flow agent drives via
 * Playwright MCP. Unlike Claude in Chrome, Playwright reaches inside Flow custom Tools (cross-origin sandboxed
 * iframe), runs in headless `claude -p` without permission prompts, and never touches the CEO's everyday Chrome.
 * Login comes from a one-time copy of the CEO's chosen profile (same Mac → same cookie key), or the CEO signs in
 * once in this window. Chrome refuses remote debugging on its default data dir, hence the separate folder.
 */
export const FLOW_CDP_PORT = Number(process.env.FLOW_CDP_PORT ?? 9333);
export const FLOW_CDP_URL = `http://127.0.0.1:${FLOW_CDP_PORT}`;
export const FLOW_CHROME_DIR = resolve(process.env.FLOW_CHROME_DIR ?? "data/flow-chrome");
const SOURCE_FILE = join(FLOW_CHROME_DIR, ".taki-source.json");
// Caches, other extensions, tab sessions and history are not needed (and would only slow the copy).
const SKIP = new Set(["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Extensions", "Sessions", "History", "History-journal", "Service Worker", "optimization_guide_model_store"]);

export type FlowSource = { channel: string; dir: string; name: string | null; email: string | null; syncedAt: string };
export const flowSource = (): FlowSource | null => { try { return JSON.parse(readFileSync(SOURCE_FILE, "utf8")); } catch { return null; } };

export async function flowBrowserUp() {
  try { return (await fetch(`${FLOW_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const b = await chromium.connectOverCDP(FLOW_CDP_URL, { timeout: 15_000 });
  try { return await fn(b); } finally { await b.close().catch(() => {}); } // close() only disconnects a CDP-attached browser
}

/**
 * Chrome keeps running with zero windows when the CEO closes the Chrome Flow window (macOS), and Playwright then
 * cannot attach ("Browser context management is not supported"). Open a blank window through the HTTP endpoint.
 */
async function ensureFlowWindow() {
  try {
    const targets = (await (await fetch(`${FLOW_CDP_URL}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as { type: string }[];
    if (targets.some((t) => t.type === "page")) return;
    await fetch(`${FLOW_CDP_URL}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
    await new Promise((r) => setTimeout(r, 1000));
  } catch { /* not up */ }
}

/** Pid of the Chrome Flow process (only a Chrome started on OUR data dir, never the CEO's own Chrome). */
function flowChromePid(): number | null {
  try {
    const pid = Number(execFileSync("lsof", ["-tnP", `-iTCP:${FLOW_CDP_PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]);
    if (!pid) return null;
    const cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return cmd.includes(`--user-data-dir=${FLOW_CHROME_DIR}`) ? pid : null;
  } catch { return null; }
}

export async function closeFlowBrowser() {
  if (!(await flowBrowserUp())) return;
  await ensureFlowWindow();
  await withBrowser(async (b) => { const s = await b.newBrowserCDPSession(); await s.send("Browser.close").catch(() => {}); }).catch((e) => logger.warn("flow.chrome_close_cdp_failed", { error: String(e).slice(0, 200) }));
  for (let i = 0; i < 20 && (await flowBrowserUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (await flowBrowserUp()) {
    // CDP close failed: stop the process itself (verified to be Chrome Flow).
    const pid = flowChromePid();
    if (pid) {
      try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
      for (let i = 0; i < 20 && (await flowBrowserUp()); i++) await new Promise((r) => setTimeout(r, 500));
      if (await flowBrowserUp()) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Copy the chosen everyday profile (cookies = Google login) into the Chrome Flow folder. */
export async function syncFlowProfile(channel: string, dir: string) {
  const ch = chromeChannel(channel);
  const prof = listChromeProfiles().find((p) => p.channel === channel && p.dir === dir);
  if (!ch || !prof) throw new AppError("NO_PROFILE", "Không thấy profile Chrome này");
  await closeFlowBrowser();
  rmSync(FLOW_CHROME_DIR, { recursive: true, force: true });
  mkdirSync(FLOW_CHROME_DIR, { recursive: true });
  const src = join(ch.dir, dir);
  cpSync(src, join(FLOW_CHROME_DIR, "Default"), { recursive: true, filter: (p) => !SKIP.has(p.slice(src.length + 1).split("/")[0]) || p === src });
  const state = JSON.parse(readFileSync(join(ch.dir, "Local State"), "utf8"));
  const entry = state.profile?.info_cache?.[dir] ?? {};
  state.profile = { ...state.profile, info_cache: { Default: { ...entry, name: "TAKI Flow" } }, last_used: "Default", last_active_profiles: ["Default"] };
  writeFileSync(join(FLOW_CHROME_DIR, "Local State"), JSON.stringify(state));
  const source: FlowSource = { channel, dir, name: prof.name, email: prof.email, syncedAt: new Date().toISOString() };
  writeFileSync(SOURCE_FILE, JSON.stringify(source, null, 2));
  logger.info("flow.profile_synced", { channel, dir });
  return source;
}

/** Start Chrome Flow if it is not running (parked at the screen edge, keeps rendering in the background). */
export async function ensureFlowBrowser(opts: { channel?: string | null; dir?: string | null; show?: boolean } = {}) {
  if (!(await flowBrowserUp())) {
    if (!existsSync(join(FLOW_CHROME_DIR, "Default")) && opts.channel && opts.dir) await syncFlowProfile(opts.channel, opts.dir);
    const ch = chromeChannel(flowSource()?.channel ?? opts.channel ?? "chrome");
    if (!ch?.exe || (ch.exe.startsWith("/") && !existsSync(ch.exe))) throw new AppError("NO_BROWSER", "Không thấy Google Chrome trên máy");
    mkdirSync(FLOW_CHROME_DIR, { recursive: true });
    const p = spawn(ch.exe, [
      `--user-data-dir=${FLOW_CHROME_DIR}`, `--remote-debugging-port=${FLOW_CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
      "--no-first-run", "--no-default-browser-check", "--window-size=1440,1000",
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    p.on("error", (e) => logger.warn("flow.chrome_spawn_failed", { error: e.message }));
    p.unref();
    let up = false;
    for (let i = 0; i < 40 && !(up = await flowBrowserUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!up) throw new AppError("BROWSER_START", "Chrome Flow không khởi động được");
  }
  await ensureFlowWindow();
  await setWindowState(opts.show ? "normal" : "parked").catch(() => {});
}

/**
 * "parked": a normal window slid almost entirely past the screen's right edge — out of the CEO's way.
 * NOT minimized: a minimized window stops producing frames (no requestAnimationFrame), so Playwright clicks
 * and screenshots hang. "normal": brought back on screen (to watch, or to sign in).
 */
export async function setWindowState(state: "parked" | "normal") {
  await withBrowser(async (b) => {
    const ctx = b.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const s = await ctx.newCDPSession(page);
    const { windowId } = await s.send("Browser.getWindowForTarget");
    await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    const scr = await page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, l: (screen as any).availLeft ?? 0, t: (screen as any).availTop ?? 0 }));
    const bounds = state === "parked"
      ? { left: scr.l + scr.w - 24, top: scr.t, width: 1440, height: Math.max(800, scr.h) }
      : { left: scr.l + 40, top: scr.t + 20, width: Math.min(1440, scr.w - 80), height: Math.max(700, scr.h - 40) };
    await s.send("Browser.setWindowBounds", { windowId, bounds });
    if (state === "normal") await page.bringToFront();
  });
}

/** Which Google accounts are signed in inside Chrome Flow (no page navigation). */
export async function flowAccounts(): Promise<string[]> {
  if (!(await flowBrowserUp())) return [];
  await ensureFlowWindow();
  return withBrowser(async (b) => {
    // Same call Google's account switcher makes (GET answers 400).
    const r = await b.contexts()[0].request.post("https://accounts.google.com/ListAccounts?json=standard&source=ogb", { timeout: 15_000 });
    const txt = await r.text();
    return [...new Set(txt.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])];
  });
}

/** Status for the UI + pre-flight check before a job. */
export async function flowBrowserStatus() {
  const running = await flowBrowserUp();
  const accounts = running ? await flowAccounts().catch(() => []) : [];
  return { running, accounts, source: flowSource(), dir: FLOW_CHROME_DIR, cdp: FLOW_CDP_URL };
}

/** Show Chrome Flow on Google sign-in so the CEO can log in once (the only manual step, ever). */
export async function openFlowLogin(opts: { channel?: string | null; dir?: string | null }) {
  await ensureFlowBrowser({ ...opts, show: true });
  await withBrowser(async (b) => {
    const page = await b.contexts()[0].newPage();
    await page.goto("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F", { timeout: 30_000 }).catch(() => {});
    await page.bringToFront();
  });
}

/** Open any page in Chrome Flow, window brought on screen (e.g. Facebook / TikTok login for "Đăng qua Chrome"). */
export async function openInFlowChrome(url: string, opts: { channel?: string | null; dir?: string | null } = {}) {
  await ensureFlowBrowser({ ...opts, show: true });
  await withBrowser(async (b) => {
    const page = await b.contexts()[0].newPage();
    await page.goto(url, { timeout: 30_000 }).catch(() => {});
    await page.bringToFront();
  });
}

/** Playwright MCP server config that attaches the agent to Chrome Flow (files it saves go to outputDir). */
export function flowMcpConfig(outputDir: string) {
  const cli = join(import.meta.dirname, "..", "node_modules", "@playwright", "mcp", "cli.js");
  return {
    mcpServers: {
      flow: {
        command: process.execPath,
        args: [cli, "--cdp-endpoint", FLOW_CDP_URL, "--allow-unrestricted-file-access", "--output-dir", outputDir, "--timeout-action", "15000", "--timeout-navigation", "60000"],
      },
    },
  };
}
