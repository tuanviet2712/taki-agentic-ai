import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";

/**
 * Chế độ nhanh của Claude CLI (bot chat trả lời trong vài giây) + 2 cờ bỏ nạp MCP/skill + ảnh cho model (chỉ công cụ Read
 * trong thư mục ảnh tạm). Giữ cách đưa system prompt qua TỆP (Windows giới hạn dòng lệnh). Không gọi Claude thật.
 */
const calls: any[] = [];
let queue: unknown[] = [];
vi.mock("./cli.ts", async (orig) => {
  const real = await orig<typeof import("./cli.ts")>();
  return {
    ...real,
    cliAvailable: () => true,
    runClaudeCli: vi.fn(async (opts: any) => {
      calls.push({ ...opts, files: opts.imageDir ? [...opts.prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]) : [], existed: opts.imageDir ? existsSync(opts.imageDir) : false });
      return { structured: queue.shift(), model: "claude-haiku-4-5", usage: { input: 10, output: 5, cached: 0 }, costMicros: 0, durationMs: 1 };
    }),
  };
});
const { buildCliArgs, cliSystemPrompt, fastEnv, fastJsonInstruction, generate, permissionPath, safeJson } = await import("./index.ts");

const Out = z.object({ reply: z.string(), wantsHandoff: z.boolean() });
const schemaJson = { type: "object", properties: { reply: { type: "string" } } };
let B: string;
beforeAll(() => {
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
});
afterAll(() => closeDb());
beforeEach(() => { calls.length = 0; queue = []; });

describe("buildCliArgs", () => {
  it("luôn tắt MCP/skill của tài khoản (--strict-mcp-config, --disable-slash-commands) và vẫn không công cụ nào", () => {
    const a = buildCliArgs({ prompt: "p", system: "s", model: "claude-haiku-4-5", jsonSchema: schemaJson }, "sys.md");
    expect(a).toEqual(expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]));
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a).not.toContain("--mcp-config"); // strict + không có cấu hình = không MCP nào
    expect(a).not.toContain("--chrome");
  });

  it("system prompt đi qua tệp (--system-prompt-file), không nằm trong dòng lệnh", () => {
    const a = buildCliArgs({ prompt: "p", system: "SYS RẤT DÀI", model: "m", jsonSchema: schemaJson }, "C:\\tmp\\system.md");
    expect(a[a.indexOf("--system-prompt-file") + 1]).toBe("C:\\tmp\\system.md");
    expect(a).not.toContain("--system-prompt");
    expect(a.join(" ")).not.toContain("SYS RẤT DÀI");
  });

  it("chế độ schema (mặc định): có --json-schema, system giữ nguyên", () => {
    const o = { prompt: "p", system: "SYS", model: "m", jsonSchema: schemaJson };
    const a = buildCliArgs(o, "f");
    expect(a[a.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schemaJson));
    expect(cliSystemPrompt(o)).toBe("SYS");
  });

  it("chế độ nhanh: không có --json-schema; lời dặn JSON + schema nằm trong system", () => {
    const o = { prompt: "p", system: "SYS", model: "m", jsonSchema: schemaJson, fast: true };
    expect(buildCliArgs(o, "f")).not.toContain("--json-schema");
    const sys = cliSystemPrompt(o);
    expect(sys.startsWith("SYS\n\n")).toBe(true);
    expect(sys).toContain(fastJsonInstruction(schemaJson));
    expect(sys).toContain(JSON.stringify(schemaJson));
  });

  it("có ảnh: chỉ công cụ Read, chỉ trong thư mục ảnh (--add-dir), dontAsk; không có Bash/Write/Edit", () => {
    const dir = join(tmpdir(), "dotaka-vision", "x1");
    const a = buildCliArgs({ prompt: "p", system: "s", model: "claude-haiku-4-5", jsonSchema: {}, imageDir: dir }, "f");
    expect(a[a.indexOf("--tools") + 1]).toBe("Read");
    expect(a[a.indexOf("--add-dir") + 1]).toBe(dir);
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    const allowed = a[a.indexOf("--allowedTools") + 1];
    expect(allowed).toBe(`Read(${permissionPath(dir)}/**)`);
    expect(allowed.startsWith("Read(//")).toBe(true);
    expect(a.filter((x) => x === "--allowedTools")).toHaveLength(1);
    expect(a.join(" ")).not.toMatch(/Bash|Write|Edit|WebFetch|--chrome/);
    expect(permissionPath("C:\\Users\\a\\Temp\\v")).toBe("//c/Users/a/Temp/v");
    expect(permissionPath("/tmp/v/")).toBe("//tmp/v");
  });

  it("effort: có với model lớn, bỏ với haiku", () => {
    expect(buildCliArgs({ prompt: "p", system: "s", model: "claude-sonnet-5", jsonSchema: {}, effort: "medium" }, "f")).toEqual(expect.arrayContaining(["--effort", "medium"]));
    expect(buildCliArgs({ prompt: "p", system: "s", model: "claude-haiku-4-5", jsonSchema: {}, effort: "medium" }, "f")).not.toContain("--effort");
  });
});

describe("fastEnv", () => {
  it("chế độ nhanh tắt suy nghĩ (MAX_THINKING_TOKENS=0); chế độ thường không đổi biến môi trường nào", () => {
    expect(fastEnv(true)).toEqual({ MAX_THINKING_TOKENS: "0" });
    expect(fastEnv(false)).toEqual({});
    expect(fastEnv()).toEqual({});
  });
});

describe("safeJson (bóc JSON từ văn bản của model)", () => {
  it("nhận JSON thuần, hàng rào ```json, và chữ thừa quanh JSON", () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeJson('Dạ đây ạ:\n{"a":{"b":2}}\nHy vọng giúp được')).toEqual({ a: { b: 2 } });
  });
  it("hỏng / không phải chữ → null / giữ nguyên", () => {
    expect(safeJson("không có json")).toBeNull();
    expect(safeJson('{"a":')).toBeNull();
    expect(safeJson({ ready: true })).toEqual({ ready: true });
  });
});

describe("generate với fast", () => {
  const ask = () => generate({ bizId: B, agentKey: "chat", tier: "small", system: "sys", user: "u", schema: Out, sandbox: () => ({ reply: "", wantsHandoff: false }), fast: true });

  it("đầu ra đúng ngay vòng đầu → chỉ 1 lần gọi, chạy ở chế độ nhanh", async () => {
    queue = [{ reply: "Dạ 12 triệu ạ", wantsHandoff: false }];
    const r = await ask();
    expect(r.output.reply).toBe("Dạ 12 triệu ạ");
    expect(calls).toHaveLength(1);
    expect(calls[0].fast).toBe(true);
  });

  it("đầu ra sai schema → tự chạy lại bằng chế độ schema chắc chắn (không mất độ tin cậy)", async () => {
    queue = [null, { reply: "Dạ ok", wantsHandoff: false }];
    const r = await ask();
    expect(r.output.reply).toBe("Dạ ok");
    expect(calls).toHaveLength(2);
    expect(calls[0].fast).toBe(true);
    expect(calls[1].fast).toBeUndefined();
    expect(calls[1].prompt).toContain("ĐẦU RA SAI SCHEMA");
  });

  it("không đặt fast → luôn chế độ schema như trước", async () => {
    queue = [{ reply: "x", wantsHandoff: false }];
    await generate({ bizId: B, agentKey: "content", tier: "medium", system: "s", user: "u", schema: Out, sandbox: () => ({ reply: "", wantsHandoff: false }) });
    expect(calls[0].fast).toBeUndefined();
  });
});

describe("generate với ảnh", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);
  const KindOut = z.object({ kind: z.string() });

  it("chép ảnh vào thư mục tạm riêng (tên trung tính), đưa đường dẫn vào lời nhắn, xoá thư mục sau khi xong; ảnh thì không chạy nhanh", async () => {
    const src = join(mkdtempSync(join(tmpdir(), "vision-gw-")), "01abc-0.png");
    writeFileSync(src, PNG);
    queue = [{ kind: "other" }];
    const r = await generate({ bizId: B, agentKey: "chat_vision", tier: "small", system: "sys", user: "Phân loại ảnh", schema: KindOut, sandbox: () => ({ kind: "x" }), images: [{ path: src, mediaType: "image/png" }], fast: true });
    expect(r.output.kind).toBe("other");
    const call = calls.at(-1);
    expect(call.imageDir).toBeTruthy();
    expect(call.existed).toBe(true);
    expect(call.fast).toBeUndefined(); // có ảnh → chế độ schema
    expect(call.files).toHaveLength(1);
    expect(dirname(call.files[0])).toBe(call.imageDir);
    expect(call.files[0]).not.toContain("01abc"); // không lộ mã tin
    expect(call.prompt).toContain("Read");
    expect(existsSync(call.imageDir)).toBe(false); // dọn sau khi chạy
    expect(buildCliArgs(call, "f")).toContain("--add-dir");
  });
});
