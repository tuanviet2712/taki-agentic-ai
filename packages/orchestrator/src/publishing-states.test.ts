import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { AppError, encryptSecret } from "@dotaka/shared";
import * as bp from "./browser-publish.ts";
import { addBrowserChannel, publishChannelFor, setChannelEnabled, setDefaultChannel } from "./browser-publish.ts";

// Chỉ ghi đè ĐƯỜNG ĐĂNG (api / Chrome) và hành động Chrome (spy) — mọi thứ khác là mã thật; Facebook là fetch giả.
let routeOverride: "api" | "browser" | "none" | null = null;
let browserImpl: (channel: Row, spec: Row) => Promise<{ status: string; permalink: string; commentPosted: boolean; notes: string }> = async () => ({ status: "done", permalink: "https://facebook.com/p/1", commentPosted: false, notes: "" });
const realPublishRoute = bp.publishRoute;
const realBrowserReady = bp.browserReady;
vi.spyOn(bp, "publishRoute").mockImplementation((ch: Row) => routeOverride ?? realPublishRoute(ch));
vi.spyOn(bp, "browserReady").mockImplementation((ch: Row) => (routeOverride === "browser" ? { ok: true } : realBrowserReady(ch)));
vi.spyOn(bp, "browserPublish").mockImplementation((ch: Row, spec: any) => browserImpl(ch, spec) as any);

const { PermanentError } = await import("./queue.ts");
const { blockNotConnected, browserFailedBeforePosting, hourMs, publishBlockReason, retryPublishJob, runPublishJob, schedulePublish, snapshotPost, SCRIPT_NOT_PUBLISHABLE_MSG, assertPublishable } = await import("./publishing.ts");
const { runDraftUpload, scheduleDrafts, reviewDnaFor } = await import("./creative.ts");
const { postingSlots, nextSlotAt, validSlots, localHour } = await import("./schedule-slots.ts");

/**
 * Trạng thái lượt đăng (đăng thật hoặc không gì cả): needs_setup / needs_check / failed / tự thử lại khi bị giới hạn tần suất,
 * kênh đăng chính, khung giờ đăng thật, số liệu bài thật, bản nháp video. Facebook = fetch giả; DB :memory:.
 */
type Call = { url: string; method: string };
let calls: Call[] = [];
let fbPost: (url: string) => Response | Promise<Response> | never = () => new Response(JSON.stringify({ id: "PAGE1_100" }), { status: 200 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mockFacebook() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    calls.push({ url: String(url), method });
    if (method === "POST") return fbPost(String(url));
    if (/fields=permalink_url/.test(String(url))) return json({ permalink_url: "https://www.facebook.com/PAGE1/posts/100" });
    if (/\/insights/.test(String(url))) return json({ data: [{ name: "post_impressions_unique", values: [{ value: 500 }] }] });
    if (/video_insights/.test(String(url))) return json({ data: [{ name: "total_video_impressions_unique", values: [{ value: 850 }] }] });
    if (/fields=likes/.test(String(url))) return json({ likes: { summary: { total_count: 42 } }, comments: { summary: { total_count: 7 } } });
    if (/reactions\.summary/.test(String(url))) return json({ reactions: { summary: { total_count: 30 } }, comments: { summary: { total_count: 5 } }, shares: { count: 2 } });
    return json({ id: "ok" });
  }));
}
const posts = () => calls.filter((c) => c.method === "POST");

let B: string, B2: string, fb: Row, conn: Row, tmp: string, seq = 0;
const content = (title: string, extra: Row = {}) =>
  insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title, body: `${title} — nội dung bài đăng thật`, status: "approved", ...extra });
const jobOf = (ci: Row, extra: Row = {}) =>
  insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: fb.id, scheduled_at: new Date().toISOString(), status: "scheduled", idempotency_key: `pub:${ci.id}:${fb.id}:${++seq}`, ...extra });
const alerts = () => q.all<Row>("SELECT * FROM outbox WHERE biz_id = ? AND type = 'alert.raised' ORDER BY created_at", B);

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  delete process.env.TIME_SCALE_SECONDS;
  openDb(":memory:");
  tmp = mkdtempSync(join(tmpdir(), "taki-publishing-"));
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  B2 = insert("biz", { name: "Shop Khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
beforeEach(() => {
  routeOverride = null;
  fbPost = () => json({ id: "PAGE1_100" });
  for (const t of ["publish_job", "post", "post_comment", "post_metric_snapshot", "content_item", "channel", "connection", "job", "outbox", "audit_log", "approval", "task", "creative_job", "creative_asset"]) q.run(`DELETE FROM ${t}`);
  conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  fb = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Fanpage Shop", external_id: "PAGE1", connection_id: conn.id, enabled: 1, whitelisted: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  mockFacebook();
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TIME_SCALE_SECONDS; });
afterAll(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe("chặn nội dung không đăng được", () => {
  it("kịch bản video chưa có video / video chưa có tệp → không xếp lịch; API trả 400", () => {
    const script = content("Kịch bản", { kind: "video_script", body: "HOOK: A | B\n\n[0-4s] cảnh\n  🎙 lời\nCaption: x" });
    expect(() => schedulePublish(B, script.id, { now: true })).toThrow(PermanentError);
    expect(q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE content_item_id = ?", script.id)).toBe(0);
    expect(publishBlockReason(script)).toBe(SCRIPT_NOT_PUBLISHABLE_MSG);
    expect(publishBlockReason({ kind: "video", asset_id: null })).toMatch(/chưa có tệp/);
    expect(publishBlockReason({ kind: "video_script", asset_id: "a1" })).toBeNull(); // có video đi kèm: publishText lấy phần Caption
    expect(publishBlockReason({ kind: "social_post" })).toBeNull();
    expect(() => assertPublishable(script)).toThrowError(AppError);
  });
});

describe("đăng thật: trạng thái lượt đăng", () => {
  it("API thành công: bài thật (link thật), nội dung tạo bài, các mốc đo số liệu theo GIỜ THẬT", async () => {
    const ci = content("Bài thật");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("done");
    const post = byId<Row>("post", j.post_id)!;
    expect(post).toMatchObject({ external_id: "PAGE1_100", permalink: "https://www.facebook.com/PAGE1/posts/100", simulated: 0, kind: "image" });
    expect(byId<Row>("content_item", ci.id)!.status).toBe("published");
    const snaps = q.all<Row>("SELECT run_at FROM job WHERE name = 'posts.snapshot' ORDER BY run_at");
    expect(snaps).toHaveLength(4);
    const first = new Date(snaps[0].run_at).getTime() - Date.now();
    expect(first).toBeGreaterThan(50 * 60_000); // mốc 1h = 1 giờ thật, không phải 1 phút
    expect(hourMs()).toBe(3_600_000);
    process.env.TIME_SCALE_SECONDS = "60"; // chỉ khi đặt rõ mới nén thời gian
    expect(hourMs()).toBe(60_000);
  });

  it("video đăng ra Reel (post.kind = reel) khi kind = video", async () => {
    const file = join(tmp, "v.mp4");
    writeFileSync(file, Buffer.alloc(64, 1));
    const asset = insert("creative_asset", { biz_id: B, kind: "video", path: file, mime: "video/mp4" });
    const ci = content("Video thật", { kind: "video", body: "Caption video\n\n---\nLời thoại:\n[Cảnh 1] x", asset_id: asset.id });
    fbPost = () => json({ id: "9001" });
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    const post = q.get<Row>("SELECT * FROM post WHERE content_item_id = ?", ci.id)!;
    expect(post.kind).toBe("reel");
    expect(post.body).toBe("Caption video");
  });

  it("kênh chưa kết nối (không token, Chrome chưa sẵn sàng) → needs_setup: không bài, bài vẫn 'đã duyệt', có cảnh báo; Đăng lại được", async () => {
    update("channel", fb.id, { connection_id: null, secret_ciphertext: null });
    const ci = content("Chưa có kênh thật");
    const job = schedulePublish(B, ci.id, { now: true })!;
    expect(byId<Row>("content_item", ci.id)!.status).toBe("scheduled");
    await runPublishJob(job.id);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("needs_setup");
    expect(j.error).toContain("CHƯA được đăng");
    expect(q.scalar<number>("SELECT COUNT(*) FROM post WHERE content_item_id = ?", ci.id)).toBe(0);
    expect(byId<Row>("content_item", ci.id)!.status).toBe("approved");
    expect(posts()).toHaveLength(0);
    expect(alerts().some((a) => a.payload?.href === "/channels")).toBe(true);
    expect(q.get("SELECT id FROM audit_log WHERE event = 'post.publish_refused' AND ref_id = ?", ci.id)).toBeTruthy();
    // sau khi kết nối (có token trở lại) → Đăng lại đúng lượt đó
    update("channel", fb.id, { connection_id: conn.id, secret_ciphertext: encryptSecret("PAGE_TOKEN") });
    const again = retryPublishJob(B, job.id, "test");
    expect(again.status).toBe("scheduled");
    expect(again.platform_state).toEqual({});
    expect(q.get("SELECT id FROM job WHERE name = 'publish.run' AND status = 'queued' AND idempotency_key LIKE ?", `pubnow:${job.id}:%`)).toBeTruthy();
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("done");
  });

  it("token hỏng (AuthError) → lượt lỗi + kết nối 'hết hạn' + cảnh báo khẩn; không tự thử lại", async () => {
    fbPost = () => json({ error: { code: 190, message: "Error validating access token" } }, 400);
    const ci = content("Token hỏng");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("failed");
    expect(byId<Row>("connection", conn.id)).toMatchObject({ status: "expired" });
    const urgent = alerts().find((a) => a.payload?.level === "urgent");
    expect(urgent?.payload.href).toBe("/ads/integrations");
    expect(q.scalar<number>("SELECT COUNT(*) FROM post WHERE content_item_id = ?", ci.id)).toBe(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'publish.run' AND status = 'queued' AND idempotency_key LIKE 'pubretry-auto%'")).toBe(0);
  });

  it("Facebook từ chối vì đăng quá nhanh (RateLimited): tự xếp lại, tối đa 3 lần rồi báo lỗi — mỗi lần chưa hề có bài", async () => {
    fbPost = () => json({ error: { code: 4, message: "Application request limit reached" } }, 400);
    const ci = content("Đăng quá nhanh");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    let j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("scheduled");
    expect(j.platform_state.rateLimitedTries).toBe(1);
    const queued = q.get<Row>("SELECT * FROM job WHERE idempotency_key = ?", `pubretry-auto:${job.id}:rate_limited:1`)!;
    expect(queued).toMatchObject({ name: "publish.run", status: "queued" });
    expect(new Date(queued.run_at).getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.platform_state.rateLimitedTries).toBe(2);
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("failed");
    expect(q.scalar<number>("SELECT COUNT(*) FROM post WHERE content_item_id = ?", ci.id)).toBe(0);
  });

  it("5xx / hết thời gian chờ sau khi gửi lệnh đăng → 'cần kiểm tra' (có thể đã lên bài), KHÔNG tự đăng lại; Đăng lại thủ công được", async () => {
    fbPost = () => new Response("{}", { status: 502 });
    const a = content("Lỗi 502");
    const ja = schedulePublish(B, a.id, { now: true })!;
    await expect(runPublishJob(ja.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", ja.id)).toMatchObject({ status: "needs_check" });
    expect(byId<Row>("publish_job", ja.id)!.error).toContain("Có thể đã đăng");
    expect(alerts().some((x) => x.payload?.key === `publish:${ja.id}` && x.payload?.href === "/publish")).toBe(true);

    fbPost = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }); };
    const b = content("Hết thời gian chờ");
    const jb = schedulePublish(B, b.id, { now: true })!;
    await expect(runPublishJob(jb.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", jb.id)!.status).toBe("needs_check");

    // một job đã needs_check không bao giờ chạy lại tự động
    const n = posts().length;
    await runPublishJob(jb.id);
    expect(posts()).toHaveLength(n);

    fbPost = () => json({ id: "PAGE1_100" });
    expect(retryPublishJob(B, jb.id, "ceo").status).toBe("scheduled");
  });

  it("không kết nối được tới Facebook (chưa gửi byte nào) → lỗi thường, không phải 'cần kiểm tra'", async () => {
    fbPost = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
    const ci = content("Mất mạng");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("failed");
  });

  it("xác minh sau đăng thất bại → 'cần kiểm tra' (không tạo bài, không đăng lại)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(init?.method) === "POST") return json({ id: "PAGE1_100" });
      if (/fields=id$/.test(String(url))) return json({ error: { code: 100, message: "Unsupported get request" } }, 400);
      return json({ permalink_url: "https://www.facebook.com/PAGE1/posts/100" });
    }));
    const ci = content("Không xác minh được");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("needs_check");
    expect(j.error).toContain("xác minh");
    expect(j.platform_state.externalId).toBe("PAGE1_100"); // còn mã bài để Sếp tìm trên Trang
    expect(q.scalar<number>("SELECT COUNT(*) FROM post WHERE content_item_id = ?", ci.id)).toBe(0);
  });

  it("job đang 'posting' (server sập giữa chừng) → needs_check, không gọi Facebook lần 2", async () => {
    const ci = content("Sập giữa chừng", { status: "scheduled" });
    const job = jobOf(ci, { status: "posting" });
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("needs_check");
    expect(posts()).toHaveLength(0);
  });

  it("Đăng lại chỉ cho lượt lỗi / cần kiểm tra / chờ kết nối; đúng doanh nghiệp", () => {
    const ci = content("Đã đăng");
    const done = jobOf(ci, { status: "done" });
    expect(() => retryPublishJob(B, done.id, "ceo")).toThrowError(/Chỉ đăng lại được/);
    expect(() => retryPublishJob(B2, done.id, "ceo")).toThrowError(/Không thấy/);
    const failed = jobOf(content("Lỗi"), { status: "failed", error: "x", platform_state: { externalId: "old" } });
    const r = retryPublishJob(B, failed.id, "ceo");
    expect(r).toMatchObject({ status: "scheduled", error: null });
    expect(r.platform_state).toEqual({});
  });

  it("nội dung còn ghi chú nội bộ → failed + 'đăng thủ công', không gọi Facebook", async () => {
    const ci = content("Rò rỉ", { body: "Bài hay. (Ghi chú nội bộ: số liệu chưa chốt)" });
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("failed");
    expect(byId<Row>("content_item", ci.id)!.status).toBe("manual_publish");
    expect(posts()).toHaveLength(0);
  });
});

describe("đăng qua Chrome: phân loại lỗi", () => {
  beforeEach(() => { routeOverride = "browser"; });

  it("thành công → bài thật qua Chrome, không đặt mốc đo số liệu (không có API)", async () => {
    browserImpl = async () => ({ status: "done", permalink: "https://www.facebook.com/PAGE1/posts/777", commentPosted: false, notes: "" });
    const ci = content("Qua Chrome");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("done");
    expect(q.get<Row>("SELECT * FROM post WHERE content_item_id = ?", ci.id)).toMatchObject({ external_id: "https://www.facebook.com/PAGE1/posts/777", simulated: 0 });
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'posts.snapshot'")).toBe(0);
  });

  it("agent tự báo blocked/failed (chắc chắn chưa đăng) → lượt lỗi thường", async () => {
    browserImpl = async () => { throw new AppError("BROWSER_PUBLISH_FAILED", "Chrome (Facebook): không thấy nút Đăng"); };
    const ci = content("Chrome báo lỗi");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("failed");
  });

  it("agent chết / hết giờ giữa chừng (có thể đã bấm Đăng) → 'cần kiểm tra'", async () => {
    browserImpl = async () => { throw new Error("Claude hết thời gian chờ sau 20 phút"); };
    const ci = content("Chrome treo");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("needs_check");
  });

  it.each(["BROWSER_OTHER_MACHINE", "CHROME_CONSENT_REQUIRED", "CHROME_APPROVER_OFF", "PATH_NOT_ALLOWED"])("kiểm tra thiết lập %s từ chối trước khi chạy publisher → lỗi thường, không báo có thể đã đăng", async (code) => {
    browserImpl = async () => { throw new AppError(code, "Setup refused before publisher launch", 409); };
    const ci = content(`Preflight ${code}`);
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("failed");
    expect(q.get("SELECT id FROM post WHERE content_item_id = ?", ci.id)).toBeUndefined();
    expect(posts()).toHaveLength(0);
  });

  it.each(["CLI_BAD_OUTPUT", "AGENT_OUTPUT", "AGENT_TIMEOUT", "AGENT_EXITED"])("agent dừng/trả lỗi %s sau khi bắt đầu → vẫn cần kiểm tra, không tự đăng lại", async (code) => {
    browserImpl = async () => { throw new AppError(code, "Agent stopped after launch", 502); };
    const ci = content(`Interrupted ${code}`);
    const job = schedulePublish(B, ci.id, { now: true })!;
    await expect(runPublishJob(job.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("needs_check");
    expect(q.get("SELECT id FROM post WHERE content_item_id = ?", ci.id)).toBeUndefined();
    expect(q.get("SELECT id FROM job WHERE idempotency_key LIKE ?", `pubretry-auto:${job.id}:%`)).toBeUndefined();
  });

  it("Chrome Flow đang dựng video (CHROME_BUSY) → xếp lại vài phút sau, không báo lỗi", async () => {
    browserImpl = async () => { throw new AppError("CHROME_BUSY", "Chrome Flow đang làm video", 409); };
    const ci = content("Chrome bận");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("scheduled");
    expect(j.platform_state.chromeBusyTries).toBe(1);
    expect(q.get("SELECT id FROM job WHERE idempotency_key = ?", `pubretry-auto:${job.id}:chrome_busy:1`)).toBeTruthy();
  });

  it("browserFailedBeforePosting: chỉ các mã chắc chắn chưa đăng", () => {
    for (const code of ["BROWSER_NOT_READY", "NO_FILE", "NEED_CLI", "NO_BROWSER", "NO_PROFILE", "BROWSER_START", "BROWSER_PUBLISH_FAILED",
      "CHROME_CONSENT_REQUIRED", "CHROME_APPROVER_OFF", "CHROME_APPROVER_MISSING", "NO_EXTENSION", "NO_BROWSER_DEVICE", "PROFILE_NOT_OPEN",
      "BROWSER_DEVICE_CHANGED", "BROWSER_NOT_CONNECTED", "BROWSER_OTHER_MACHINE", "BROWSER_NOT_SELECTED", "PATH_NOT_ALLOWED"]) expect(browserFailedBeforePosting(new AppError(code, "x"))).toBe(true);
    for (const code of ["CLI_BAD_OUTPUT", "AGENT_OUTPUT", "AGENT_TIMEOUT", "AGENT_EXITED", "UNKNOWN_ERROR"]) expect(browserFailedBeforePosting(new AppError(code, "x"))).toBe(false);
    expect(browserFailedBeforePosting(new Error("timeout"))).toBe(false);
  });
});

describe("kênh đăng chính, bật/tắt, thêm kênh", () => {
  it("publishChannelFor ưu tiên kênh đăng chính; bỏ kênh tắt / đã gỡ; đổi kênh chính", () => {
    const second = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Trang phụ", external_id: "PAGE2", enabled: 1, meta: {} });
    expect(publishChannelFor(B, "facebook")?.id).toBe(fb.id); // sớm nhất
    setDefaultChannel(B, second.id, "ceo");
    expect(publishChannelFor(B, "facebook")?.id).toBe(second.id);
    expect(byId<Row>("channel", fb.id)!.meta.isDefault).toBe(false);
    setChannelEnabled(B, second.id, false, "ceo");
    expect(byId<Row>("channel", second.id)!.meta.isDefault).toBe(false);
    expect(publishChannelFor(B, "facebook")?.id).toBe(fb.id);
    update("channel", fb.id, { meta: { removedAt: new Date().toISOString() } });
    expect(publishChannelFor(B, "facebook")).toBeUndefined();
    expect(publishChannelFor(B, "tiktok")).toBeUndefined();
    expect(() => setDefaultChannel(B2, second.id, "ceo")).toThrowError(/Không thấy/);
  });

  it("bài đăng vào kênh đăng chính khi có nhiều Trang", async () => {
    const second = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Trang chính", external_id: "PAGE2", connection_id: conn.id, enabled: 1, whitelisted: 1, secret_ciphertext: encryptSecret("T2"), meta: { isDefault: true } });
    const job = schedulePublish(B, content("Vào trang chính").id, { now: true })!;
    expect(job.channel_id).toBe(second.id);
  });

  it("addBrowserChannel: cần link Trang hợp lệ; trùng link bị từ chối; kênh đầu tiên là kênh chính; kênh đã gỡ được bật lại", () => {
    expect(() => addBrowserChannel(B, { platform: "tiktok", name: "x", profileUrl: "https://evil.example/@x" }, "ceo")).toThrow();
    expect(() => addBrowserChannel(B, { platform: "tiktok", name: "x", profileUrl: "" }, "ceo")).toThrow();
    const a = addBrowserChannel(B, { platform: "tiktok", name: "TAKI TikTok", profileUrl: "https://www.tiktok.com/@takiacademy" }, "ceo");
    expect(a).toMatchObject({ platform: "tiktok", isDefault: true, enabled: 1, profileUrl: "https://www.tiktok.com/@takiacademy" });
    const row = byId<Row>("channel", a.id)!;
    expect(row.external_id).toBe("@takiacademy");
    expect(row.meta).toMatchObject({ publishVia: "browser", browser: { profileUrl: "https://www.tiktok.com/@takiacademy" } });
    expect(() => addBrowserChannel(B, { platform: "tiktok", name: "Lại", profileUrl: "https://www.tiktok.com/@takiacademy" }, "ceo")).toThrowError(/đã có/);
    const b = addBrowserChannel(B, { platform: "tiktok", name: "TikTok 2", profileUrl: "https://www.tiktok.com/@khac" }, "ceo");
    expect(b.isDefault).toBe(false);
    // gỡ (như route DELETE) rồi thêm lại cùng link → bật lại, không tạo dòng mới
    update("channel", row.id, { enabled: 0, meta: { ...row.meta, removedAt: new Date().toISOString() } });
    const again = addBrowserChannel(B, { platform: "tiktok", name: "TAKI TikTok", profileUrl: "https://www.tiktok.com/@takiacademy" }, "ceo");
    expect(again.id).toBe(a.id);
    expect(byId<Row>("channel", a.id)!.meta.removedAt).toBeUndefined();
    expect(q.scalar<number>("SELECT COUNT(*) FROM channel WHERE biz_id = ? AND platform = 'tiktok'", B)).toBe(2);
  });
});

describe("khung giờ đăng thật", () => {
  it("postingSlots mặc định 8h / 11h30 / 20h (giờ VN); giá trị lạ bị lọc; nextSlotAt chọn khung kế tiếp còn trống", () => {
    expect(postingSlots(B)).toEqual([8, 11.5, 20]);
    expect(validSlots([6, 9, 9, 23, "x", 14.5])).toEqual([9, 14.5]);
    expect(validSlots([1, 2])).toBeNull();
    // 06:30 giờ VN = 23:30Z hôm trước → khung kế tiếp 08:00 VN
    const from = new Date("2026-10-09T23:30:00Z");
    expect(localHour(nextSlotAt([8, 11.5, 20], from))).toBe(8);
    expect(localHour(nextSlotAt([8, 11.5, 20], from, 1))).toBe(11.5);
    expect(localHour(nextSlotAt([8, 11.5, 20], from, 3))).toBe(8); // hết khung trong ngày → ngày hôm sau
    expect(nextSlotAt([8, 11.5, 20], from, 3).getTime()).toBeGreaterThan(nextSlotAt([8, 11.5, 20], from, 2).getTime());
    // sát giờ: chưa đủ 10 phút thì bỏ qua khung đó
    expect(localHour(nextSlotAt([8, 11.5, 20], new Date("2026-10-10T00:55:00Z")))).toBe(11.5);
  });

  it("schedulePublish (không 'đăng ngay') đặt vào khung giờ VN, bài sau lấy khung sau", () => {
    const j1 = schedulePublish(B, content("Bài 1").id)!;
    const j2 = schedulePublish(B, content("Bài 2").id)!;
    expect([8, 11.5, 20]).toContain(localHour(new Date(j1.scheduled_at)));
    expect(new Date(j2.scheduled_at).getTime()).toBeGreaterThan(new Date(j1.scheduled_at).getTime());
    expect([8, 11.5, 20]).toContain(localHour(new Date(j2.scheduled_at)));
    expect(new Date(j1.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });
});

describe("số liệu của bài thật", () => {
  const mkPost = (channel: Row, kind = "image", externalId = "PAGE1_100") =>
    insert("post", { biz_id: B, channel_id: channel.id, external_id: externalId, kind, title: "Bài", body: "Bài thật", published_at: new Date(Date.now() - 3600_000).toISOString(), permalink: "https://facebook.com/x", ad_status: "none", simulated: 0 });

  it("đọc số liệu bằng token Trang của chính kênh (không phải connector mô phỏng), không bịa bình luận", async () => {
    const p = mkPost(fb);
    await snapshotPost(p.id, "1h");
    const snap = q.get<Row>("SELECT metrics FROM post_metric_snapshot WHERE post_id = ?", p.id)!;
    expect(snap.metrics).toEqual({ reach: 500, reactions: 30, comments: 5, shares: 2, saves: 0 });
    expect(calls.some((c) => /graph\.facebook\.com/.test(c.url))).toBe(true);
    expect(q.scalar<number>("SELECT COUNT(*) FROM post_comment WHERE post_id = ?", p.id)).toBe(0);
  });

  it("video (mã không có '_') hỏi trường của Video, không gọi reactions (từng lỗi #100)", async () => {
    const p = mkPost(fb, "reel", "9001");
    await snapshotPost(p.id, "1h");
    const snap = q.get<Row>("SELECT metrics FROM post_metric_snapshot WHERE post_id = ?", p.id)!;
    expect(snap.metrics).toEqual({ reach: 850, reactions: 42, comments: 7, shares: 0, saves: 0 });
    expect(calls.map((c) => decodeURIComponent(c.url)).join(" ")).not.toContain("reactions");
  });

  it("kết nối thật nhưng không còn token Trang (đã ngắt) → bỏ qua, KHÔNG ghi số liệu giả", async () => {
    update("channel", fb.id, { secret_ciphertext: null });
    const p = mkPost(byId<Row>("channel", fb.id)!);
    await snapshotPost(p.id, "1h");
    expect(q.scalar<number>("SELECT COUNT(*) FROM post_metric_snapshot WHERE post_id = ?", p.id)).toBe(0);
    expect(q.get("SELECT id FROM audit_log WHERE event = 'post.snapshot_skipped' AND ref_id = ?", p.id)).toBeTruthy();
  });
});

describe("bản nháp video", () => {
  const mkVideo = (title = "Video nháp") => {
    const file = join(tmp, `${title}.mp4`);
    writeFileSync(file, Buffer.alloc(64, 2));
    const asset = insert("creative_asset", { biz_id: B, kind: "video", path: file, mime: "video/mp4" });
    const ci = content(title, { kind: "video", body: "Caption nháp\n\n---\nLời thoại:\n[Cảnh 1] x", status: "awaiting_approval", asset_id: asset.id });
    const job = insert("creative_job", { biz_id: B, tool: "review-do-an-vat", title, status: "approved", input: { channels: ["facebook"], tool: "review-do-an-vat", title, brief: "x", brand: "other" }, content_item_id: ci.id, asset_id: asset.id, workdir: tmp });
    return { ci, job, asset };
  };
  const draftJob = (ci: Row, assetId: string, extra: Row = {}) =>
    insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: fb.id, scheduled_at: new Date().toISOString(), status: "scheduled", idempotency_key: `draft:${ci.id}:${++seq}`, mode: "draft", asset_id: assetId, ...extra });

  it("scheduleDrafts: vào kênh đăng chính, không ghi đè bài đã đăng/đã lên lịch", () => {
    const second = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Trang chính", external_id: "PAGE2", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("T2"), meta: { isDefault: true } });
    const { ci, job } = mkVideo();
    const made = scheduleDrafts(B, job.id, "ceo");
    expect(made).toHaveLength(1);
    expect(byId<Row>("publish_job", made[0])!.channel_id).toBe(second.id);
    expect(byId<Row>("content_item", ci.id)!.status).toBe("approved");
    // bài đã đăng công khai không bị kéo ngược về "approved"
    const { ci: ci2, job: job2 } = mkVideo("Video đã đăng");
    update("content_item", ci2.id, { status: "published" });
    scheduleDrafts(B, job2.id, "ceo");
    expect(byId<Row>("content_item", ci2.id)!.status).toBe("published");
  });

  it("nháp lên kênh thật: draft_uploaded + content 'draft_on_channel'", async () => {
    fbPost = () => json({ id: "7001" });
    const { ci, asset } = mkVideo();
    update("content_item", ci.id, { status: "approved" });
    const pj = draftJob(ci, asset.id);
    await runDraftUpload(pj.id);
    expect(byId<Row>("publish_job", pj.id)).toMatchObject({ status: "draft_uploaded", simulated: 0 });
    expect(byId<Row>("content_item", ci.id)!.status).toBe("draft_on_channel");
    expect(posts()).toHaveLength(1);
  });

  it("lượt nháp đang 'posting' (sập giữa chừng) → needs_check, không tải lần 2; kênh chưa kết nối → needs_setup", async () => {
    const { ci, asset } = mkVideo();
    const stuck = draftJob(ci, asset.id, { status: "posting" });
    await runDraftUpload(stuck.id);
    expect(byId<Row>("publish_job", stuck.id)!.status).toBe("needs_check");
    expect(posts()).toHaveLength(0);

    update("channel", fb.id, { connection_id: null, secret_ciphertext: null });
    const pj = draftJob(ci, asset.id);
    await runDraftUpload(pj.id);
    const j = byId<Row>("publish_job", pj.id)!;
    expect(j.status).toBe("needs_setup");
    expect(j.error).toContain("video (bản nháp) CHƯA được tải lên kênh");
    expect(posts()).toHaveLength(0);
  });

  it("token hỏng khi tải nháp → lượt lỗi + kết nối hết hạn; hết thời gian chờ → cần kiểm tra", async () => {
    const { ci, asset } = mkVideo();
    update("content_item", ci.id, { status: "approved" });
    fbPost = () => json({ error: { code: 190, message: "Error validating access token" } }, 400);
    const a = draftJob(ci, asset.id);
    await expect(runDraftUpload(a.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", a.id)!.status).toBe("failed");
    expect(byId<Row>("connection", conn.id)!.status).toBe("expired");

    update("connection", conn.id, { status: "active" });
    fbPost = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }); };
    const b = draftJob(ci, asset.id);
    await expect(runDraftUpload(b.id)).rejects.toBeInstanceOf(PermanentError);
    expect(byId<Row>("publish_job", b.id)!.status).toBe("needs_check");
  });

  it("Đăng lại một lượt nháp chạy lại hàng đợi nháp (không phải đăng công khai)", () => {
    const { ci, asset } = mkVideo();
    const pj = draftJob(ci, asset.id, { status: "failed", error: "x" });
    retryPublishJob(B, pj.id, "ceo");
    expect(q.get("SELECT id FROM job WHERE name = 'publish.draft' AND status = 'queued' AND idempotency_key LIKE ?", `draftrun:${pj.id}:%`)).toBeTruthy();
    expect(q.get("SELECT id FROM job WHERE name = 'publish.run' AND idempotency_key LIKE ?", `pubnow:${pj.id}%`)).toBeUndefined();
  });
});

describe("reviewDnaFor (chấm video kênh khách / affiliate)", () => {
  const dna: Row = {
    company: { name: "TAKI", brand: "TAKI" }, voice: { style: ["chuyên gia"], do: [], dont: [], sample: "x" }, bannedChars: ["!"], forbiddenClaims: ["khỏi bệnh"], audience: [{ name: "CEO", pains: [], goals: [] }],
    products: [{ name: "Sữa X", price: 250000, offer: "Giảm 50.000đ", sellingPoints: ["ít đường"], audience: "Mẹ bỉm" }, { name: "Khóa Y", price: 1 }],
  };
  it("brand taki: giữ nguyên DNA; brand khác: dữ kiện của sản phẩm + giữ nguyên tuyên bố cấm, bỏ giọng/ký tự cấm của TAKI", () => {
    const base = { tool: "auto-video", title: "Video", brief: "x", channels: ["tiktok"] } as any;
    expect(reviewDnaFor({ ...base, brand: "taki" }, dna)).toEqual({ dna, facts: [] });
    const r = reviewDnaFor({ ...base, brand: "other", product: "Sữa X" }, dna);
    expect(r.facts.map((f) => f.statement)).toEqual(["Giá Sữa X: 250000đ", "Ưu đãi: Giảm 50.000đ", "ít đường"]);
    expect(r.dna.forbiddenClaims).toEqual(["khỏi bệnh"]);
    expect(r.dna.bannedChars).toEqual([]);
    expect(r.dna.company.name).toBe("Sữa X");
    expect(r.dna.products).toHaveLength(1);
    expect(reviewDnaFor({ ...base, brand: "other" }, dna).dna.products).toHaveLength(2);
  });
});

describe("blockNotConnected", () => {
  it("không đổi bài đã đăng; chỉ trả 'đã duyệt' bài đang 'đã lên lịch'", () => {
    update("channel", fb.id, { connection_id: null, secret_ciphertext: null });
    const ci = content("Đã đăng rồi", { status: "published" });
    const job = jobOf(ci);
    blockNotConnected(job, ci, byId<Row>("channel", fb.id)!);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("needs_setup");
    expect(byId<Row>("content_item", ci.id)!.status).toBe("published");
  });
});
