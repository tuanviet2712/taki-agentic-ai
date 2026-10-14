import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, update } from "@dotaka/db";

const fake = vi.hoisted(() => ({ login: null as any, stop: vi.fn() }));
vi.mock("./codex.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), codexInfo: () => ({ available: true, version: "test" }), codexLoginStatus: async () => true,
  stopCodex: fake.stop,
  spawnCodexLogin: () => { fake.login = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() }); return fake.login; },
}));
const accounts = await import("./ai-accounts.ts");
const root = mkdtempSync(join(tmpdir(), "taki-accounts-test-"));
let b1: string, b2: string, a1: string, a2: string;
beforeAll(() => {
  vi.stubEnv("AI_ACCOUNTS_DIR", root); openDb(":memory:");
  b1 = insert("biz", { name: "One", settings: DEFAULT_SETTINGS }).id; b2 = insert("biz", { name: "Two", settings: DEFAULT_SETTINGS }).id;
  a1 = accounts.createAiAccount(b1, "Cá nhân", "test").id; a2 = accounts.createAiAccount(b1, "Công ty", "test").id;
});
afterAll(() => { closeDb(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function auth(id: string) {
  const claims = Buffer.from(JSON.stringify({ email: `${id}@example.test`, "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } })).toString("base64url");
  writeFileSync(join(accounts.aiAccountHome(b1, id), "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "ACCESS-SECRET", refresh_token: "REFRESH-SECRET", id_token: `x.${claims}.x` } }));
}
describe("Account isolation and login lifecycle", () => {
  it("creates separate profiles without adopting the desktop login; rejects another business's IDs", () => {
    expect(accounts.aiAccountHome(b1, a1)).not.toBe(accounts.aiAccountHome(b1, a2)); expect(accounts.listAiAccounts(b2)).toEqual([]);
    expect(accounts.selectedAiAccount(b1)).toBeNull(); expect(accounts.listAiAccounts(b1).every((a) => !a.loggedIn)).toBe(true);
    expect(() => accounts.aiAccountHome(b2, a1)).toThrow("doanh nghiệp này"); expect(() => accounts.startAiLogin(b2, a1, "browser", "test")).toThrow("doanh nghiệp này");
  });
  it("extracts only official URLs/device codes, serializes logins, and exposes no raw auth secrets", () => {
    expect(accounts.parseLoginOutput("https://evil.example/steal\nhttps://auth.openai.com/codex/device\nABCD-EFGH")).toEqual({ url: "https://auth.openai.com/codex/device", code: "ABCD-EFGH" });
    accounts.startAiLogin(b1, a1, "device", "test"); fake.login.stdout.emit("data", Buffer.from("https://auth.openai.com/codex/device\nABCD-EFGH"));
    expect(() => accounts.startAiLogin(b1, a2, "browser", "test")).toThrow("Đang chờ");
    expect(accounts.listAiAccounts(b1, false)[0].login).not.toHaveProperty("code");
    auth(a1); fake.login.emit("close", 0);
    const out = accounts.listAiAccounts(b1)[0]; expect(out).toMatchObject({ loggedIn: true, login: { state: "done" }, plan: "plus" });
    expect(JSON.stringify(out)).not.toMatch(/ACCESS-SECRET|REFRESH-SECRET|auth.json|CODEX_HOME/);
    update("biz", b1, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: a1 } } }); expect(accounts.selectedAiAccount(b1)?.id).toBe(a1);
  });
  it("captures the chosen profile while defaults change, and blocks re-login during a live run", async () => {
    auth(a2); let release!: () => void;
    const pending = accounts.withAiAccount(b1, a1, async (home) => { await new Promise<void>((r) => { release = r; }); return home; });
    await Promise.resolve();
    update("biz", b1, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: a2 } } });
    expect(() => accounts.startAiLogin(b1, a1, "browser", "test")).toThrow("đang chạy"); release();
    expect(await pending).toBe(accounts.aiAccountHome(b1, a1)); expect(accounts.selectedAiAccount(b1)?.id).toBe(a2);
  });
  it("serializes calls within one profile, allows different profiles, and cancels a pending login", async () => {
    const order: string[] = []; let release!: () => void;
    const one = accounts.withAiAccount(b1, a1, async () => { order.push("one"); await new Promise<void>((r) => { release = r; }); });
    const two = accounts.withAiAccount(b1, a1, async () => { order.push("two"); });
    await accounts.withAiAccount(b1, a2, async () => { order.push("other"); });
    expect(order).toEqual(["one", "other"]); release(); await Promise.all([one, two]); expect(order).toEqual(["one", "other", "two"]);
    accounts.startAiLogin(b1, a2, "device", "test"); const cancel = accounts.cancelAiLogin(b1, a2); fake.login.emit("close", 1); await cancel; expect(fake.stop).toHaveBeenCalled(); expect(accounts.listAiAccounts(b1)[1].login?.state).toBe("cancelled");
  });
});
