import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update } from "@dotaka/db";

const fake = vi.hoisted(() => ({ calls: [] as any[], pause: false, release: null as (() => void) | null }));
vi.mock("../../llm-gateway/src/codex.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), codexInfo: () => ({ available: true, version: "test" }), runCodexAgent: vi.fn(async (o) => {
  fake.calls.push(o);
  if (fake.pause) await new Promise<void>((done, reject) => {
    const abort = () => reject(new Error("cancelled")); o.signal.addEventListener("abort", abort, { once: true }); fake.release = () => { o.signal.removeEventListener("abort", abort); done(); };
  });
  o.onStep?.({ at: new Date().toISOString(), kind: "tool", text: "taki.doc" }); o.onStep?.({ at: new Date().toISOString(), kind: "text", text: "Dạ, em đã kiểm tra báo cáo." });
  return { text: "Dạ, em đã kiểm tra báo cáo.", model: "default", usage: { input: 100, output: 15, cached: 20 }, durationMs: 10, costMicros: 0 };
}) }));
const gateway = await import("@dotaka/llm-gateway");
const { createThread, sendAssistantMessage, stopAssistant, checkActionPath } = await import("./assistant.ts");
const root = mkdtempSync(join(tmpdir(), "taki-assistant-codex-test-"));
let biz: string, a1: string, a2: string, thread: string;
beforeAll(() => {
  vi.stubEnv("AI_ACCOUNTS_DIR", root); openDb(":memory:"); biz = insert("biz", { name: "Shop hai", settings: DEFAULT_SETTINGS }).id;
  a1 = gateway.createAiAccount(biz, "A", "test").id; a2 = gateway.createAiAccount(biz, "B", "test").id;
  for (const id of [a1, a2]) {
    const claims = Buffer.from(JSON.stringify({ email: `${id}@test.local` })).toString("base64url");
    writeFileSync(join(gateway.aiAccountHome(biz, id), "auth.json"), JSON.stringify({ tokens: { access_token: "a", refresh_token: "r", id_token: `x.${claims}.x` } }));
  }
  update("biz", biz, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: a1 } } }); thread = createThread(biz).id;
});
afterAll(() => { closeDb(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("Ngân Nguyệt with a selected ChatGPT account", () => {
  it("uses the existing guarded MCP tools with the correct business and persists progress/usage", async () => {
    const r = await sendAssistantMessage(biz, thread, "Xem báo cáo giúp tôi");
    await vi.waitFor(() => expect(byId<any>("assistant_message", r.message!.id)?.status).toBe("done"));
    const call = fake.calls[0]; expect(call.home).toBe(gateway.aiAccountHome(biz, a1)); expect(call.mcp.taki.env).toMatchObject({ TAKI_BIZ: biz, TAKI_THREAD: thread });
    expect(call.prompt.match(/Xem báo cáo giúp tôi/g)).toHaveLength(1); expect(call.system).toContain("NGÂN NGUYỆT");
    expect(byId<any>("assistant_message", r.message!.id)?.log).toHaveLength(2); expect(q.get<any>("SELECT provider,tokens_in FROM model_usage WHERE biz_id = ?", biz)).toMatchObject({ provider: "codex_cli", tokens_in: 100 });
    expect(() => checkActionPath("/v1/llm/accounts/abc/login")).toThrow("chỉ Sếp");
  });
  it("keeps the in-flight account, starts a fresh session after account switch and preserves conversation context", async () => {
    fake.pause = true;
    const r = await sendAssistantMessage(biz, thread, "Câu tiếp theo");
    await vi.waitFor(() => expect(fake.calls.length).toBe(2)); const oldSession = byId<any>("assistant_thread", thread).session_id;
    update("biz", biz, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: a2 } } });
    expect(fake.calls[1].home).toBe(gateway.aiAccountHome(biz, a1)); fake.release!(); fake.pause = false;
    await vi.waitFor(() => expect(byId<any>("assistant_message", r.message!.id)?.status).toBe("done"));
    const next = await sendAssistantMessage(biz, thread, "Dùng tài khoản mới");
    await vi.waitFor(() => expect(byId<any>("assistant_message", next.message!.id)?.status).toBe("done"));
    expect(fake.calls[2].home).toBe(gateway.aiAccountHome(biz, a2)); expect(fake.calls[2].prompt).toContain("Xem báo cáo giúp tôi"); expect(byId<any>("assistant_thread", thread).session_id).not.toBe(oldSession);
  });
  it("propagates the stop button to the Codex run and frees the account", async () => {
    fake.pause = true; const r = await sendAssistantMessage(biz, thread, "Dừng lượt này"); await vi.waitFor(() => expect(fake.calls.length).toBe(4));
    stopAssistant(thread); await vi.waitFor(() => expect(byId<any>("assistant_message", r.message!.id)?.status).toBe("stopped"));
    expect(gateway.selectedAiAccount(biz)?.running).toBe(0); fake.pause = false;
  });
});
