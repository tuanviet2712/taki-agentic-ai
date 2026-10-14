import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q } from "@dotaka/db";

/** Kịch bản minh hoạ không làm được bằng Flow → dựng từ VIDEO THÔ Sếp tải lên (thay cho kho Pexels/Pixabay). */
const cwd = process.cwd();
const work = mkdtempSync(join(tmpdir(), "taki-footage-test-"));
let sv: typeof import("./script-video.ts");
beforeAll(async () => {
  process.env.DB_PATH = ":memory:"; openDb(":memory:");
  process.chdir(work); // data/uploads của test nằm trong thư mục tạm
  sv = await import("./script-video.ts");
});
afterAll(() => { process.chdir(cwd); rmSync(work, { recursive: true, force: true }); });

const SCRIPT = (extra = "") => `HOOK: Ba việc nên giao cho AI | x

[0-4s] Màn hình làm việc, đồ thị chạy.
  🎙 Mỗi ngày bạn trả lương cho người làm việc lặp lại.
  🅣 VIỆC LẶP LẠI
[4-9s] Bàn phím gõ nhanh. ${extra}
  🎙 Ba việc đó AI làm xong trong mười phút.

CTA: Nhắn tin nhận lộ trình
Caption: Giao việc cho AI.

#ai`;
let B = "";
const video = (name: string) => { const dir = join(work, "data", "uploads"); mkdirSync(dir, { recursive: true }); const p = join(dir, name); writeFileSync(p, "fake"); return p; };
const script = (body: string) => insert("content_item", { biz_id: B, agent_key: "video_script", kind: "video_script", channel: "facebook", title: "Ba việc nên giao cho AI", body, status: "approved" });

beforeEach(() => {
  for (const t of ["biz", "content_item", "creative_job", "job", "agent_config", "dna_profile"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS } }).id;
  insert("agent_config", { biz_id: B, agent_key: "creative", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 100000, token_budget_day: 1000000, limits: {} });
});

describe("makeVideoFromScript với video thô", () => {
  it("tạo việc dựng từ video thô: đúng tool, kịch bản duyệt đi kèm nguyên văn, đúng video đã tải", () => {
    const ci = script(SCRIPT());
    const r = sv.makeVideoFromScript(B, ci.id, "ceo", undefined, { materials: [video("a.mp4"), video("b.mp4")], style: "smooth", music: "none" });
    expect(r.already).toBe(false);
    const job = byId<any>("creative_job", r.jobId!)!;
    expect(job.tool).toBe("edit-source");
    expect(job.source_content_id).toBe(ci.id);
    expect(job.input.script.scenes).toHaveLength(2);
    expect(job.input.script.scenes[0]).toMatchObject({ voice: "Mỗi ngày bạn trả lương cho người làm việc lặp lại.", onScreen: "VIỆC LẶP LẠI" });
    expect(job.input.video).toMatchObject({ style: "smooth", music: "none", aspect: "9:16" });
    expect(job.input.video.materials).toHaveLength(2);
    expect(job.input.hookTitle).toBe("Ba việc nên giao cho AI");
    expect(job.input.cta).toBe("Nhắn tin nhận lộ trình");
  });
  it("kế hoạch không đòi khóa Pexels/Pixabay khi Sếp có video thô", () => {
    const ci = script(SCRIPT());
    const without = sv.planVideoFromScript(B, ci.id);
    const withFootage = sv.planVideoFromScript(B, ci.id, { footage: true });
    expect(withFootage.tool).toBe("auto-video");
    expect(withFootage.missing.some((m) => /Pexels|Pixabay|video thô/i.test(m))).toBe(false);
    expect(without.missing.some((m) => /video thô/i.test(m))).toBe(true); // nói rõ cách mở khoá: tải video thô
  });
  it("video thô KHÔNG làm mất kiểm tra số liệu / ý còn chờ xác nhận", () => {
    const ci = script(SCRIPT("(Ghi chú nội bộ: số liệu chưa chốt) ⚠️ 250+ doanh nghiệp"));
    expect(() => sv.makeVideoFromScript(B, ci.id, "ceo", undefined, { materials: [video("a.mp4")] })).toThrow(/Chưa đủ để tạo video/);
    expect(q.scalar("SELECT COUNT(*) FROM creative_job")).toBe(0);
  });
  it("chỉ nhận video trong thư mục tải lên (không trỏ tới tệp tuỳ ý trên máy)", () => {
    const ci = script(SCRIPT());
    const outside = join(work, "ngoai.mp4"); writeFileSync(outside, "x");
    expect(() => sv.makeVideoFromScript(B, ci.id, "ceo", undefined, { materials: [outside] })).toThrow();
  });
  it("kịch bản người thật / review sản phẩm có tool riêng → không dùng đường video thô", () => {
    const ci = script(SCRIPT().replace("Màn hình làm việc", "Kiểm ngồi bàn, nhìn thẳng vào camera"));
    expect(() => sv.makeVideoFromScript(B, ci.id, "ceo", undefined, { materials: [video("a.mp4")] })).toThrow(/tool riêng/);
  });
});
