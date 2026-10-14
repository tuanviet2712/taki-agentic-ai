import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Các lượt chạy `claude` dùng chung cho Chrome Flow (Playwright) và Claude in Chrome — KHÔNG gọi Claude thật, KHÔNG mở Chrome:
 * `node:child_process` được thay bằng "tiến trình giả" ghi lại lệnh + tệp cấu hình tại thời điểm spawn.
 *  - Nhóm "chrome-flow (mặc định)" ghim chính xác dòng lệnh cũ (argFile / stdin / PowerShell / taskkill) — phải y hệt trước và sau
 *    khi thêm engine Claude in Chrome.
 *  - Nhóm "Claude in Chrome" kiểm tra bộ duyệt quyền (--permission-prompt-tool), nối lại phiên, và công tắc tắt khẩn cấp.
 */
const home = mkdtempSync(join(tmpdir(), "cli-chrome-home-"));
delete process.env.CLAUDE_CLI_PATH;

// ensureTrusted() and transcript reads use a temporary home without changing system environment variables.
vi.mock("node:os", async (orig) => {
  const real = await orig<typeof import("node:os")>();
  return { ...real, homedir: () => home };
});

type Call = { cmd: string; args: string[]; opts: any; files: Record<string, string>; stdin?: string };
const calls: Call[] = [];
let script: (c: Call, child: any, n: number) => void = () => {};

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return {
    ...real,
    execFileSync: vi.fn(() => ""),
    spawn: vi.fn((cmd: string, args: string[], opts: any) => {
      const call: Call = { cmd, args: [...args], opts, files: {} };
      // Tệp cấu hình/ system prompt bị dọn sau khi chạy → đọc ngay lúc spawn.
      for (const flag of ["--append-system-prompt-file", "--system-prompt-file", "--mcp-config"]) {
        const i = args.indexOf(flag);
        if (i >= 0) { try { call.files[flag] = readFileSync(args[i + 1]!, "utf8"); } catch { /* chưa có */ } }
      }
      calls.push(call);
      const child: any = new EventEmitter();
      child.pid = 2147483000;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = () => {};
      child.stdin = Object.assign(new EventEmitter(), {
        end: (t?: string) => { call.stdin = t ?? ""; setImmediate(() => script(call, child, calls.length)); },
      });
      // Lượt headless của runClaudeInTerminal không có stdin pipe (stdio[0] là tệp) → chạy kịch bản ngay.
      if (opts?.detached) setImmediate(() => script(call, child, calls.length));
      return child;
    }),
  };
});

const { RESUME_PROMPT, runClaudeAgent, runClaudeInTerminal } = await import("./cli.ts");

const emit = (child: any, ev: object) => child.stdout.emit("data", `${JSON.stringify(ev)}\n`);
const okResult = (child: any, structured: unknown = { ok: true }) => {
  emit(child, { type: "result", subtype: "success", is_error: false, structured_output: structured, usage: {}, modelUsage: {} });
  child.emit("close", 0);
};
const after = (args: string[], flag: string, n = 1) => args.slice(args.indexOf(flag) + 1, args.indexOf(flag) + 1 + n);
/** Mọi giá trị của một cờ lặp lại (--add-dir a --add-dir b). */
const repeated = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));
/** Phần giá trị của một cờ variadic (đến cờ `--xxx` kế tiếp). */
const values = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const out: string[] = [];
  for (const a of args.slice(i + 1)) { if (a.startsWith("--")) break; out.push(a); }
  return out;
};

let work: string;
beforeEach(() => { calls.length = 0; script = (_c, child) => okResult(child); work = mkdtempSync(join(tmpdir(), "cli-chrome-")); delete process.env.ALLOW_CHROME_AUTOAPPROVE; });
afterEach(() => { vi.useRealTimers(); });

const base = { prompt: "Làm video", system: "SYSTEM RẤT DÀI", model: "claude-sonnet-5", jsonSchema: { type: "object" }, allowedTools: ["mcp__flow", "Read"], addDirs: ["/d/a", "/d/b"], cwd: "" };

describe("runClaudeAgent — Chrome Flow (mặc định, không đổi)", () => {
  it("dontAsk + --no-chrome + không lưu phiên; system prompt qua TỆP; prompt qua stdin; MCP chỉ khi có mcpConfig", async () => {
    const r = await runClaudeAgent({ ...base, cwd: work, mcpConfig: { mcpServers: { flow: { command: "x" } } } });
    expect(r.structured).toEqual({ ok: true });
    const c = calls[0]!;
    expect(c.args.slice(0, 7)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-5", "--append-system-prompt-file"]);
    expect(after(c.args, "--json-schema")).toEqual([JSON.stringify({ type: "object" })]);
    expect(after(c.args, "--permission-mode")).toEqual(["dontAsk"]);
    expect(values(c.args, "--allowedTools")).toEqual(["mcp__flow", "Read"]);
    expect(c.args).toContain("--no-session-persistence");
    expect(c.args).not.toContain("--session-id");
    expect(c.args).not.toContain("--permission-prompt-tool");
    expect(c.args).toContain("--no-chrome");
    expect(c.args).not.toContain("--chrome");
    expect(c.args).toContain("--strict-mcp-config");
    expect(after(c.args, "--setting-sources")).toEqual([""]);
    expect(repeated(c.args, "--add-dir")).toEqual(["/d/a", "/d/b"]);
    expect(c.files["--append-system-prompt-file"]).toBe("SYSTEM RẤT DÀI");
    expect(c.args.join(" ")).not.toContain("SYSTEM RẤT DÀI"); // Windows: dòng lệnh ~32 KB
    expect(JSON.parse(c.files["--mcp-config"]!)).toEqual({ mcpServers: { flow: { command: "x" } } });
    expect(c.stdin).toBe("Làm video");
    expect(c.opts.cwd).toBe(work);
  });

  it("không mcpConfig → không --mcp-config/--strict-mcp-config", async () => {
    await runClaudeAgent({ ...base, cwd: work });
    expect(calls[0]!.args).not.toContain("--mcp-config");
    expect(calls[0]!.args).not.toContain("--strict-mcp-config");
  });
});

describe("runClaudeInTerminal — nhánh headless Chrome Flow (không đổi)", () => {
  const run = async (extra: object = {}) => {
    const resultFile = join(work, "result.json");
    script = (c) => { writeFileSync(resultFile, JSON.stringify({ status: "done" })); void c; };
    const res = await runClaudeInTerminal({
      title: "t", prompt: "BRIEF DÀI", system: "SYS", model: "claude-sonnet-5", cwd: work, resultFile, timeoutMs: 60_000,
      mcpConfig: { mcpServers: { flow: { command: "playwright" } } }, env: { PATH: "x" },
      disallowedTools: ["TaskCreate"], allowedTools: ["mcp__flow", "Read", "Bash(cp:*)"], addDirs: [work, "/d/uploads"], ...extra,
    });
    return { res, c: calls[0]! };
  };

  it("dontAsk + --no-chrome + --session-id + --strict-mcp-config + cấu hình MCP riêng; tách rời; PowerShell bị cấm trên Windows", async () => {
    const { res, c } = await run();
    expect(res).toEqual({ status: "done" });
    const a = c.args;
    const win = process.platform === "win32";
    expect(a).toContain("-p");
    expect(after(a, "--model")).toEqual(["claude-sonnet-5"]);
    expect(after(a, "--permission-mode")).toEqual(["dontAsk"]);
    expect(a).toContain("--session-id");
    expect(a).toContain("--no-chrome");
    expect(a).not.toContain("--chrome");
    expect(a).toContain("--strict-mcp-config");
    expect(a).not.toContain("--permission-prompt-tool");
    expect(after(a, "--setting-sources")).toEqual([""]);
    expect(values(a, "--allowedTools")).toEqual(["mcp__flow", "Read", "Bash(cp:*)"]);
    expect(values(a, "--disallowedTools")).toEqual(win ? ["TaskCreate", "PowerShell"] : ["TaskCreate"]);
    expect(repeated(a, "--add-dir")).toEqual([work, "/d/uploads"]);
    expect(JSON.parse(c.files["--mcp-config"]!)).toEqual({ mcpServers: { flow: { command: "playwright" } } });
    expect(c.files["--append-system-prompt-file"]).toBe("SYS");
    expect(c.opts.detached).toBe(true);
    expect(c.opts.windowsHide).toBe(true);
    // Windows: prompt qua tệp (stdin); nơi khác: tham số vị vị đầu tiên.
    if (win) { expect(a).not.toContain("BRIEF DÀI"); expect(typeof c.opts.stdio[0]).toBe("number"); } else expect(a[0]).toBe("BRIEF DÀI");
    expect(readFileSync(join(dirname(join(work, "result.json")), ".taki-run", win ? "prompt-run.md" : "system.md"), "utf8")).toBe(win ? "BRIEF DÀI" : "SYS");
    expect(c.opts.env.PATH ?? c.opts.env.Path).toBe("x");
  });

  it("Playwright (mcpConfig) vẫn chạy trên Windows; thiếu cả mcpConfig và Chrome → NOT_SUPPORTED như cũ ngoài macOS/Linux", async () => {
    if (process.platform === "win32") {
      await expect(runClaudeInTerminal({ title: "t", prompt: "p", system: "s", model: "m", cwd: work, resultFile: join(work, "r.json"), timeoutMs: 1000, allowedTools: [], addDirs: [] }))
        .rejects.toThrow(/macOS\/Linux/);
    }
  });
});

describe("Claude in Chrome — bộ duyệt quyền, nối lại phiên, tắt khẩn cấp", () => {
  const approverCfg = { fileRoots: ["/d/work"], hosts: ["facebook.com"], logFile: "/d/work/approver.jsonl", js: false, killFile: "/d/data/off" };

  it("chrome:true (runClaudeAgent): --chrome + --permission-prompt-tool + cấu hình MCP taki_approver; KHÔNG dontAsk; công cụ Chrome không nằm trong --allowedTools", async () => {
    await runClaudeAgent({ ...base, cwd: work, chrome: true, approver: approverCfg, allowedTools: ["mcp__claude-in-chrome", "mcp__claude-in-chrome__navigate", "Read(//d/work/**)"] });
    const a = calls[0]!.args;
    expect(a).toContain("--chrome");
    expect(a).not.toContain("--no-chrome");
    expect(after(a, "--permission-prompt-tool")).toEqual(["mcp__taki_approver__approve"]);
    expect(a).not.toContain("--permission-mode");
    expect(a).toContain("--strict-mcp-config");
    // Chrome phải đi qua bộ duyệt: không để luật --allowedTools cho qua cả loạt.
    expect(values(a, "--allowedTools")).toEqual(["Read(//d/work/**)"]);
    const cfg = JSON.parse(calls[0]!.files["--mcp-config"]!);
    expect(Object.keys(cfg.mcpServers)).toEqual(["taki_approver"]);
    const s = cfg.mcpServers.taki_approver;
    expect(s.command).toBe(process.execPath);
    expect(s.args[0]).toMatch(/chrome-approver\.mjs$/);
    expect(JSON.parse(s.env.TAKI_APPROVER_FILE_ROOTS)).toEqual(["/d/work"]);
    expect(JSON.parse(s.env.TAKI_APPROVER_HOSTS)).toEqual(["facebook.com"]);
    expect(s.env.TAKI_APPROVER_LOG).toBe("/d/work/approver.jsonl");
    expect(s.env.TAKI_APPROVER_JS).toBe("off");
    expect(s.env.TAKI_APPROVER_KILL_FILE).toBe("/d/data/off");
  });

  it("chrome:true + mcpConfig: giữ các MCP khác và thêm bộ duyệt", async () => {
    await runClaudeAgent({ ...base, cwd: work, chrome: true, approver: approverCfg, mcpConfig: { mcpServers: { other: { command: "o" } } } });
    expect(Object.keys(JSON.parse(calls[0]!.files["--mcp-config"]!).mcpServers).sort()).toEqual(["other", "taki_approver"]);
  });

  it("khám phá Chrome chỉ có công cụ cần duyệt → bỏ cờ --allowedTools rỗng (CLI yêu cầu ít nhất một giá trị)", async () => {
    await runClaudeAgent({ ...base, cwd: work, chrome: true, approver: approverCfg, allowedTools: ["mcp__claude-in-chrome__list_connected_browsers"] });
    expect(calls[0]!.args).not.toContain("--allowedTools");
    expect(calls[0]!.args).toContain("--permission-prompt-tool");
  });

  it("công tắc tắt khẩn cấp ALLOW_CHROME_AUTOAPPROVE=0: không chạy, không spawn", async () => {
    process.env.ALLOW_CHROME_AUTOAPPROVE = "0";
    await expect(runClaudeAgent({ ...base, cwd: work, chrome: true, approver: approverCfg })).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
    expect(calls).toHaveLength(0);
    // Không Chrome (Chrome Flow) KHÔNG bị công tắc này chặn.
    await runClaudeAgent({ ...base, cwd: work });
    expect(calls).toHaveLength(1);
  });

  it("chrome:true thiếu approver → từ chối (không bao giờ chạy Chrome không có bộ duyệt)", async () => {
    await expect(runClaudeAgent({ ...base, cwd: work, chrome: true })).rejects.toMatchObject({ code: "CHROME_APPROVER_MISSING" });
    expect(calls).toHaveLength(0);
  });

  it("resume: ngắt lần 1 → --resume đúng phiên + RESUME_PROMPT; kết quả của lần nối lại", async () => {
    script = (c, child, n) => { emit(child, { type: "assistant", message: { content: [{ type: "text", text: `bước ${n}` }] } }); if (n === 1) child.emit("close", 1); else okResult(child, { n }); };
    const steps: string[] = [];
    const r = await runClaudeAgent({ ...base, cwd: work, resume: { max: 2, delayMs: 0 }, onStep: (s) => steps.push(s.text) });
    expect(r.structured).toEqual({ n: 2 });
    expect(r.resumes).toBe(1);
    const sid = after(calls[0]!.args, "--session-id")[0]!;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(after(calls[1]!.args, "--resume")).toEqual([sid]);
    expect(calls[0]!.stdin).toBe("Làm video");
    expect(calls[1]!.stdin).toBe(RESUME_PROMPT);
    expect(steps.some((t) => /tự nối lại phiên \(lần 1\/2\)/.test(t))).toBe(true);
  });

  it("resume: ngắt mãi → 3 lần chạy rồi báo lỗi; không bật resume → 1 lần, --no-session-persistence", async () => {
    script = (_c, child) => child.emit("close", 1);
    await expect(runClaudeAgent({ ...base, cwd: work, resume: { max: 2, delayMs: 0 } })).rejects.toThrow(/không có kết quả/);
    expect(calls).toHaveLength(3);
    calls.length = 0;
    await expect(runClaudeAgent({ ...base, cwd: work })).rejects.toThrow(/không có kết quả/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain("--no-session-persistence");
  });

  it("runClaudeInTerminal chrome:true (headless, mcpConfig rỗng): --chrome + bộ duyệt, không dontAsk, vẫn tách rời + PowerShell bị cấm", async () => {
    const resultFile = join(work, "result.json");
    script = () => { writeFileSync(resultFile, JSON.stringify({ status: "done" })); };
    mkdirSync(work, { recursive: true });
    await runClaudeInTerminal({
      title: "t", prompt: "BRIEF", system: "SYS", model: "claude-sonnet-5", cwd: work, resultFile, timeoutMs: 60_000,
      mcpConfig: { mcpServers: {} }, chrome: true, approver: approverCfg,
      allowedTools: ["mcp__claude-in-chrome", "Read(//d/work/**)", "Bash(cp:*)"], addDirs: [work],
    });
    const c = calls[0]!;
    const a = c.args;
    expect(a).toContain("--chrome");
    expect(a).not.toContain("--no-chrome");
    expect(after(a, "--permission-prompt-tool")).toEqual(["mcp__taki_approver__approve"]);
    expect(a).not.toContain("--permission-mode");
    expect(a).toContain("--session-id");
    expect(values(a, "--allowedTools")).toEqual(["Read(//d/work/**)", "Bash(cp:*)"]);
    if (process.platform === "win32") expect(values(a, "--disallowedTools")).toContain("PowerShell");
    expect(Object.keys(JSON.parse(c.files["--mcp-config"]!).mcpServers)).toEqual(["taki_approver"]);
    expect(c.opts.detached).toBe(true);
  });

  it("runClaudeInTerminal chrome:true bị công tắc khẩn cấp chặn trước khi spawn", async () => {
    process.env.ALLOW_CHROME_AUTOAPPROVE = "0";
    await expect(runClaudeInTerminal({
      title: "t", prompt: "p", system: "s", model: "m", cwd: work, resultFile: join(work, "r.json"), timeoutMs: 1000,
      mcpConfig: { mcpServers: {} }, chrome: true, approver: approverCfg, allowedTools: [], addDirs: [],
    })).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
    expect(calls).toHaveLength(0);
  });

  it("tệp công tắc chặn trước khi spawn và khi phiên chuẩn bị nối lại", async () => {
    const killFile = join(work, "chrome-off");
    writeFileSync(killFile, "off");
    await expect(runClaudeAgent({ ...base, cwd: work, chrome: true, approver: { ...approverCfg, killFile } })).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
    expect(calls).toHaveLength(0);
    const { rmSync } = await import("node:fs");
    rmSync(killFile);
    script = (_c, child) => { writeFileSync(killFile, "off"); child.emit("close", 1); };
    await expect(runClaudeAgent({ ...base, cwd: work, chrome: true, approver: { ...approverCfg, killFile }, resume: { max: 2, delayMs: 0 } })).rejects.toMatchObject({ code: "CHROME_APPROVER_OFF" });
    expect(calls).toHaveLength(1);
  });

  it("hủy trong thời gian chờ nối lại: không spawn phiên mới", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    script = (_c, child) => child.emit("close", 1);
    const pending = runClaudeAgent({ ...base, cwd: work, resume: { max: 2, delayMs: 15_000 }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
  });

  it("timeout áp dụng cho cả phiên, không nối lại khi còn ít thời gian; abort sẵn thì không spawn", async () => {
    vi.useFakeTimers();
    script = (_c, child) => child.emit("close", 1);
    const pending = runClaudeAgent({ ...base, cwd: work, timeoutMs: 1000, resume: { max: 2, delayMs: 0 } });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CLI_BAD_OUTPUT" });
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(calls).toHaveLength(1);
    calls.length = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(runClaudeAgent({ ...base, cwd: work, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("kết quả lỗi nghiệp vụ không được chạy lại dù đã bật resume", async () => {
    script = (_c, child) => { emit(child, { type: "result", subtype: "error_max_turns", is_error: true, result: "max turns" }); child.emit("close", 1); };
    await expect(runClaudeAgent({ ...base, cwd: work, resume: { max: 2, delayMs: 0 } })).rejects.toMatchObject({ code: "AGENT_ERROR" });
    expect(calls).toHaveLength(1);
  });
});
