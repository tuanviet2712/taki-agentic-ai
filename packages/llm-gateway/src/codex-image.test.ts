import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Tạo ảnh bằng ChatGPT (Codex CLI): bật đúng tính năng image_generation cho lượt đó, lấy ảnh của đúng lượt chạy, dọn thư mục. */
const fake = vi.hoisted(() => ({ spawn: vi.fn(), thread: "01a12b11-7a23-7893-972a-c56348dc3314", makeImage: true, configs: [] as string[] }));
vi.mock("node:child_process", async (original) => ({ ...(await original<Record<string, unknown>>()), spawn: fake.spawn }));
const { codexImageDir, codexRunConfig, runCodexImage } = await import("./codex.ts");
const home = mkdtempSync(join(tmpdir(), "taki-codex-img-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  fake.makeImage = true; fake.configs = []; fake.spawn.mockReset();
  fake.spawn.mockImplementation((_bin: string, args: string[]) => {
    const child: any = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
    fake.configs.push(readFileSync(join(home, `${args[args.indexOf("--profile") + 1]}.config.toml`), "utf8"));
    child.stdin = Object.assign(new EventEmitter(), { end: () => setImmediate(() => {
      if (fake.makeImage) {
        const dir = join(home, "generated_images", fake.thread);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "exec-1.png"), Buffer.from("PNG-BYTES"));
      }
      child.stdout.emit("data", [
        JSON.stringify({ type: "thread.started", thread_id: fake.thread }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Đã tạo ảnh." } }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 9, cached_input_tokens: 40 } }),
      ].join("\n"));
      child.emit("close", 0);
    }) });
    return child;
  });
});

describe("ChatGPT image generation through Codex CLI", () => {
  it("keeps image generation off for every normal run", () => {
    expect(codexRunConfig({ home, prompt: "p", system: "s", model: "default" })).toContain("image_generation = false");
    expect(codexRunConfig({ home, prompt: "p", system: "s", model: "default", imageGeneration: true })).toContain("image_generation = true");
  });
  it("copies the image of this run to the requested file and cleans the Codex folder", async () => {
    const out = join(home, "out", "post.png");
    const r = await runCodexImage({ home, system: "s", prompt: "vẽ ảnh", model: "default", outFile: out });
    expect(readFileSync(out, "utf8")).toBe("PNG-BYTES");
    expect(r.usage).toEqual({ input: 100, output: 9, cached: 40 });
    expect(fake.configs[0]).toContain("image_generation = true");
    expect(fake.configs[0]).toContain("shell_tool = false"); // vẫn không có shell / trình duyệt / plugin
    expect(existsSync(join(home, "generated_images", fake.thread))).toBe(false);
  });
  it("fails clearly when ChatGPT answered but produced no image", async () => {
    fake.makeImage = false;
    await expect(runCodexImage({ home, system: "s", prompt: "p", model: "default", outFile: join(home, "out", "none.png") })).rejects.toMatchObject({ code: "CODEX_NO_IMAGE" });
  });
  it("never resolves an image folder outside the profile", () => {
    expect(codexImageDir(home, "../../etc")).toBeNull();
    expect(codexImageDir(home, fake.thread)).toBe(join(home, "generated_images", fake.thread));
  });
});
