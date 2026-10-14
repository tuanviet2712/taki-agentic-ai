import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Nhật ký agent đọc transcript của phiên Claude: `offset` đếm BYTE nhưng trước đây cắt chuỗi theo KÝ TỰ → với tiếng Việt (nhiều ký tự
// nhiều byte) mỗi lần đọc mất một đoạn, dần dần mất hết và nhật ký đứng yên dù agent vẫn chạy.
const home = mkdtempSync(join(tmpdir(), "taki-transcript-test-"));
const session = "11111111-2222-3333-4444-555555555555";
const file = join(home, ".claude", "projects", "proj", `${session}.jsonl`);
const { transcriptReader } = await import("./cli.ts");
beforeAll(() => { vi.stubEnv("USERPROFILE", home); vi.stubEnv("HOME", home); mkdirSync(join(home, ".claude", "projects", "proj"), { recursive: true }); writeFileSync(file, ""); });
afterAll(() => { rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const line = (text: string) => `${JSON.stringify({ type: "assistant", timestamp: "2026-10-13T03:00:00.000Z", message: { content: [{ type: "text", text }] } })}\n`;

describe("transcriptReader", () => {
  it("không bỏ sót bước nào khi transcript có nhiều ký tự tiếng Việt, đọc nhiều lần", () => {
    const steps: string[] = [];
    const read = transcriptReader(session, (s) => steps.push(s.text));
    const sent: string[] = [];
    for (let round = 0; round < 40; round++) {
      // mỗi lượt: 1 dòng dài toàn dấu tiếng Việt (nhiều byte/ký tự) + 1 dòng ngắn
      const long = `Cảnh ${round}: ${"Thuê thêm người, doanh thu vẫn đứng im — ".repeat(30)}`.slice(0, 280);
      const short = `Bước ${round} xong`;
      appendFileSync(file, line(long) + line(short));
      sent.push(long.trim().slice(0, 300), short);
      read();
    }
    expect(steps).toEqual(sent);
  });

  it("dòng đang ghi dở được chờ tới lần đọc sau, không mất và không đọc đôi", () => {
    const steps: string[] = [];
    const read = transcriptReader(session, (s) => steps.push(s.text));
    read();
    steps.length = 0; // bỏ phần cũ trong tệp (reader mới đọc từ đầu)
    const full = line("Dòng đang ghi dở — tiếng Việt có dấu");
    const cut = Buffer.from(full).subarray(0, 40); // cắt giữa dòng (có thể giữa một ký tự nhiều byte)
    appendFileSync(file, cut);
    read();
    expect(steps).toEqual([]);
    appendFileSync(file, Buffer.from(full).subarray(40));
    read();
    expect(steps).toEqual(["Dòng đang ghi dở — tiếng Việt có dấu"]);
  });
});
