import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, bizSettings, closeDb, insert, openDb, update } from "@dotaka/db";
const root = mkdtempSync(join(tmpdir(), "taki-workspace-ai-test-"));
vi.stubEnv("WORKSPACE_FILE", join(root, "workspace.json"));
const { applyWorkspace, exportWorkspace, WORKSPACE_FILE } = await import("./workspace.ts");
let biz: string;
beforeAll(() => { openDb(":memory:"); biz = insert("biz", { name: "Export", settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: "local-person-account", models: { small: "default" } } } }).id; });
afterAll(() => { closeDb(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("Portable workspace without a baked-in ChatGPT account", () => {
  it("removes account selection from exports without changing live settings", () => {
    const s = exportWorkspace(biz); expect(s.settings.llm.codexAccountId).toBeNull(); expect(readFileSync(WORKSPACE_FILE, "utf8")).not.toContain("local-person-account");
    expect((bizSettings(biz) as any).llm.codexAccountId).toBe("local-person-account");
  });
  it("never imports another install's account; keeps an explicitly chosen local profile", async () => {
    const file = join(root, "incoming.json"); writeFileSync(file, JSON.stringify({ settings: { llm: { provider: "codex_cli", codexAccountId: "foreign-account" } } }));
    await applyWorkspace(biz, file); expect((bizSettings(biz) as any).llm.codexAccountId).toBe("local-person-account");
    update("biz", biz, { settings: DEFAULT_SETTINGS }); await applyWorkspace(biz, file); expect((bizSettings(biz) as any).llm.codexAccountId).toBeNull();
  });
});
