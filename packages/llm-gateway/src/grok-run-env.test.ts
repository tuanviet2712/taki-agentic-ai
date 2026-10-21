import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALL_PROVIDER_CATALOGS, grokModelCatalog } from "./index.ts";
import { grokAvailableModels, grokRunEnv, resolveGrokModel } from "./grok.ts";

/** GROK_HOME giả: bộ nhớ đệm `grok models` của tài khoản chỉ có grok-4.7, grok-4.6, grok-4.5 và 1 model mới. */
let home: string;
const saved = { GROK_HOME: process.env.GROK_HOME, GROK_RUN_HOME: process.env.GROK_RUN_HOME };
const writeCache = (ids: string[]) =>
  writeFileSync(join(home, "models_cache.json"), JSON.stringify({ models: Object.fromEntries(ids.map((id) => [id, { info: { id, name: id.toUpperCase(), description: `mô tả ${id}`, hidden: id.endsWith("-hidden") } }])) }));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "grok-home-test-"));
  process.env.GROK_HOME = home;
  process.env.GROK_RUN_HOME = join(home, "run-home");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  rmSync(home, { recursive: true, force: true });
});

describe("Grok CLI: chạy không nạp skill Claude của người dùng + chỉ dùng model tài khoản có", () => {
  it("runs prompts with an empty private HOME/USERPROFILE but the real GROK_HOME (login kept, ~/.claude skills not scanned)", () => {
    const env = grokRunEnv();
    expect(env.GROK_HOME).toBe(home);
    expect(env.HOME).toBe(join(home, "run-home"));
    expect(env.USERPROFILE).toBe(join(home, "run-home"));
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("maps a model the account does not have (old settings: grok-4.3, grok-build-0.1) to a usable one", () => {
    writeCache(["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.7-build-fast", "grok-x-hidden"]);
    expect(grokAvailableModels()?.map((m) => m.id)).toEqual(["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.7-build-fast"]);
    expect(resolveGrokModel("grok-4.3")).toBe("grok-4.6");
    expect(resolveGrokModel("grok-build-0.1")).toBe("grok-4.6");
    expect(resolveGrokModel("grok-4.7")).toBe("grok-4.7");
    expect(resolveGrokModel("default")).toBe("grok-4.6");
    expect(resolveGrokModel(undefined)).toBe("grok-4.6");
  });

  it("shows only the account's Grok models in every model picker, plus new ones the static list lacks", () => {
    writeCache(["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.7-build-fast", "grok-5-preview"]);
    const ids = grokModelCatalog().map((m) => m.id);
    // grok-4.5 tài khoản vẫn có nhưng đã gỡ khỏi danh sách (yếu) → không hiện lại; model mới của tài khoản thì hiện
    expect(ids).toEqual(["grok-4.7", "grok-4.6", "grok-4.7-build-fast", "grok-5-preview"]);
    expect(ALL_PROVIDER_CATALOGS.grok_cli.map((m) => m.id)).toEqual(ids);
    expect(JSON.parse(JSON.stringify(ALL_PROVIDER_CATALOGS)).grok_cli.map((m: any) => m.id)).toEqual(ids);
  });

  it("keeps the static list and the requested model when the account's model list is unknown", () => {
    expect(grokAvailableModels()).toBeNull();
    expect(grokModelCatalog().map((m) => m.id)).toEqual(["grok-4.7", "grok-4.6", "grok-4.7-build-fast"]);
    expect(resolveGrokModel("grok-4.6")).toBe("grok-4.6");
  });
});
