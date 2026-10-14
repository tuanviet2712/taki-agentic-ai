import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ output: "", stderr: "", spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<Record<string, unknown>>()), execFileSync: vi.fn(() => "2.1.293"),
  spawn: fake.spawn,
}));
let cli: typeof import("./cli.ts");
beforeEach(async () => {
  vi.resetModules();
  fake.output = "";
  fake.stderr = "";
  fake.spawn.mockReset();
  fake.spawn.mockImplementation(() => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin = Object.assign(new EventEmitter(), { end: () => setImmediate(() => {
      child.stdout.emit("data", fake.output);
      child.stderr.emit("data", fake.stderr);
      child.emit("close", 1);
    }) });
    return child;
  });
  cli = await import("./cli.ts");
});

describe("Claude login probe: readable errors without misclassifying quota", () => {
  it("shows the quota reset message from result rather than leading JSON metadata", async () => {
    const quota = "You've hit your limit · resets Oct 14, 7am (Asia/Ho_Chi_Minh)";
    fake.output = JSON.stringify({ type: "result", subtype: "error_during_execution", duration_api_ms: 99, is_error: true, result: quota });
    await expect(cli.probeCliAuth()).resolves.toBeNull();
    expect(cli.cliInfo()).toMatchObject({ available: true, loggedIn: null, authError: quota });
    expect(cli.cliInfo().authError).not.toContain("duration_api_ms");
    expect(fake.spawn).toHaveBeenCalledTimes(1);
  });

  it("extracts errors arrays and nested message objects for temporary failures", async () => {
    fake.output = JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution", result: "", errors: ["Rate limit reached", { message: "Try again later" }] });
    await expect(cli.probeCliAuth()).resolves.toBeNull();
    expect(cli.cliInfo()).toMatchObject({ loggedIn: null, authError: "Rate limit reached; Try again later" });
  });

  it("marks real authentication failures false and reports their readable message", async () => {
    fake.output = JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution", errors: [{ message: "Failed to authenticate. Please run /login" }] });
    await expect(cli.probeCliAuth()).resolves.toBe(false);
    expect(cli.cliInfo()).toMatchObject({ loggedIn: false, authError: "Failed to authenticate. Please run /login" });
  });

  it("preserves plaintext failures and clears the message on a successful probe", async () => {
    fake.output = "";
    fake.stderr = "Service unavailable. Try later.";
    await expect(cli.probeCliAuth()).resolves.toBeNull();
    expect(cli.cliInfo().authError).toBe("Service unavailable. Try later.");
    vi.resetModules();
    cli = await import("./cli.ts");
    fake.output = JSON.stringify({ type: "result", is_error: false, subtype: "success", result: "hi" });
    fake.stderr = "";
    await expect(cli.probeCliAuth()).resolves.toBe(true);
    expect(cli.cliInfo()).toMatchObject({ loggedIn: true, authError: undefined });
  });
});
