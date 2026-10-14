import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import * as bp from "./browser-publish.ts";

// Chrome "sẵn sàng" = có Claude CLI (giả) + đã chọn profile Chrome + kênh đã xác nhận đăng nhập; đường API là fetch giả, còn lại là mã thật.
vi.mock("@dotaka/llm-gateway", async (orig) => ({ ...(await orig<Record<string, unknown>>()), effectiveProvider: () => ({ provider: "claude_cli" }) }));

const { chromeLock, draftRoute, publishRoute, routeReason, channelPublishInfo } = bp;
const { runPublishJob, schedulePublish, snapshotPost, maybeCreateCandidate } = await import("./publishing.ts");
const { runDraftUpload, scheduleDrafts } = await import("./creative.ts");
const { setPublicGateway } = await import("./tracking.ts");
const { verifyMediaToken } = await import("./public-media.ts");

/**
 * Đăng Instagram / TikTok qua API: chọn đường, id container / publish_id lưu để chạy lại không đăng trùng, xử lý lâu → xếp lại,
 * TikTok chưa duyệt → chỉ bản nháp (không đăng riêng tư âm thầm), không số liệu giả, bài Instagram không thành ứng viên quảng cáo.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
let handler: (c: Call) => Response | Promise<Response>;
function stub(h: (c: Call) => Response | Promise<Response>) {
  calls = [];
  handler = h;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), body: init?.body instanceof Buffer ? "<bytes>" : String(init?.body ?? "") };
    calls.push(c);
    return handler(c);
  }));
}
/** Instagram giả: container FINISHED ngay. */
const igOk = (c: Call) => {
  if (c.method === "POST" && c.url.endsWith("/IG1/media")) return json({ id: "CONT1" });
  if (c.url.includes("/CONT1?")) return json({ status_code: "FINISHED" });
  if (c.method === "POST" && c.url.endsWith("/IG1/media_publish")) return json({ id: "17900001" });
  if (c.url.includes("/17900001?")) return json({ permalink: "https://www.instagram.com/reel/abc/" });
  return json({});
};

let B: string, tmp: string, igChan: Row, ttChan: Row, ttConn: Row, seq = 0;
const asset = (name: string, mime: string, kind = "video") => {
  const file = join(tmp, name);
  writeFileSync(file, Buffer.alloc(256, 3));
  return insert("creative_asset", { biz_id: B, kind, path: file, mime });
};
const reel = (title: string, extra: Row = {}) => {
  const a = asset(`${title}.mp4`, "video/mp4");
  return insert("content_item", { biz_id: B, agent_key: "content", kind: "video", channel: "instagram", title, body: `${title} caption\n\n---\nLời thoại:\n[Cảnh 1] x`, status: "approved", asset_id: a.id, ...extra });
};
const jobOf = (ci: Row, ch: Row, extra: Row = {}) => insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: ch.id, scheduled_at: new Date().toISOString(), status: "scheduled", idempotency_key: `pub:${ci.id}:${ch.id}:${++seq}`, ...extra });

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  tmp = mkdtempSync(join(tmpdir(), "taki-igtt-"));
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
});
beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
  setPublicGateway({ listening: true, port: 8788 });
  for (const t of ["publish_job", "post", "post_comment", "post_metric_snapshot", "content_item", "channel", "connection", "job", "outbox", "audit_log", "creative_job", "creative_asset", "ad_candidate", "approval", "track_link"]) q.run(`DELETE FROM ${t}`);
  const meta = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } }), B);
  igChan = insert("channel", { biz_id: B, platform: "instagram", kind: "business", name: "@lanshop", external_id: "IG1", connection_id: meta.id, enabled: 1, whitelisted: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: { pageId: "PAGE1" } });
  ttConn = insert("connection", { biz_id: B, platform: "tiktok_post", external_account_id: "open1", token_ciphertext: encryptSecret(JSON.stringify({ access_token: "TT_ACCESS", refresh_token: "R" })), status: "active", mode: "live", config: { token_expires_at: new Date(Date.now() + 6 * 3600_000).toISOString() } });
  ttChan = insert("channel", { biz_id: B, platform: "tiktok", kind: "business", name: "Kênh TikTok", external_id: "open1", connection_id: ttConn.id, enabled: 1, whitelisted: 1, meta: {} });
  stub(igOk);
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => { delete process.env.PUBLIC_BASE_URL; setPublicGateway({ listening: false }); closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe("chọn đường đăng", () => {
  it("Instagram: có địa chỉ công khai + cổng → API; chưa có → Chrome nếu sẵn sàng (đúng khoá flow-chrome), không thì chờ thiết lập", () => {
    expect(publishRoute(igChan)).toBe("api");
    expect(channelPublishInfo(igChan)).toMatchObject({ api: true, apiBlock: null });
    setPublicGateway({ listening: false });
    expect(publishRoute(igChan)).toBe("none");
    expect(routeReason(igChan)).toMatch(/PUBLIC_BASE_URL/);
    expect(channelPublishInfo(igChan).apiBlock).toMatch(/PUBLIC_BASE_URL/);
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, flow: { chromeProfileDir: "Default" } }), B);
    update("channel", igChan.id, { meta: { ...igChan.meta, browser: { loggedIn: true } } });
    const fresh = byId<Row>("channel", igChan.id)!;
    expect(publishRoute(fresh)).toBe("browser");
    expect(chromeLock(fresh)).toBe("flow-chrome");
  });

  it("TikTok: chưa duyệt → đăng công khai KHÔNG qua API (Chrome / chờ thiết lập) nhưng BẢN NHÁP vẫn qua API; đã duyệt → API", () => {
    expect(publishRoute(ttChan)).toBe("none");
    expect(routeReason(ttChan)).toMatch(/TikTok duyệt/);
    expect(draftRoute(ttChan)).toBe("api");
    expect(chromeLock(ttChan, "draft")).toBeUndefined(); // nháp qua API: không chiếm khoá Chrome
    update("connection", ttConn.id, { config: { ...ttConn.config, audited: "1" } });
    expect(publishRoute(ttChan)).toBe("api");
    expect(channelPublishInfo(ttChan)).toMatchObject({ audited: true, apiBlock: null });
  });
});

describe("Instagram qua API", () => {
  it("đăng Reel: link media công khai ký sẵn (/m/<token>), id container / media được lưu GỘP vào platform_state; bài thật, không thành ứng viên quảng cáo", async () => {
    const ci = reel("Reel Lan");
    const job = schedulePublish(B, ci.id, { now: true })!;
    update("publish_job", job.id, { platform_state: { rateLimitedTries: 1 } });
    await runPublishJob(job.id);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("done");
    expect(j.platform_state).toMatchObject({ rateLimitedTries: 1, containerId: "CONT1", mediaId: "17900001", externalId: "17900001" });
    const post = byId<Row>("post", j.post_id)!;
    expect(post).toMatchObject({ external_id: "17900001", permalink: "https://www.instagram.com/reel/abc/", kind: "reel", simulated: 0 });
    const create = new URLSearchParams(calls.find((c) => c.url.endsWith("/IG1/media"))!.body);
    expect(create.get("media_type")).toBe("REELS");
    const videoUrl = create.get("video_url")!;
    expect(videoUrl).toMatch(/^https:\/\/link\.taki\.vn\/m\//);
    expect(verifyMediaToken(videoUrl.split("/m/")[1])?.assetId).toBe(ci.asset_id);
    // bài Instagram không thành ứng viên "Meta boost"
    expect(maybeCreateCandidate(post, 99, false, [])).toBeNull();
    expect(q.all("SELECT id FROM ad_candidate")).toHaveLength(0);
    // Instagram không tự gắn link dưới bình luận
    expect(q.all("SELECT id FROM job WHERE name = 'posts.comment_link'")).toHaveLength(0);
  });

  it("chạy lại với containerId đã lưu: không tạo container mới (không đăng trùng)", async () => {
    const ci = reel("Reel resume");
    const job = jobOf(ci, igChan, { platform_state: { containerId: "CONT1" } });
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("done");
    expect(calls.filter((c) => c.url.endsWith("/IG1/media"))).toHaveLength(0);
    expect(calls.filter((c) => c.url.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("xử lý media quá lâu (Transient 'resumable') → xếp lại sau 3 phút, KHÔNG phải 'cần kiểm tra'; id container giữ nguyên", async () => {
    stub((c) => (c.url.endsWith("/IG1/media") ? json({ id: "CONT1" }) : c.url.includes("/CONT1?") ? json({ status_code: "IN_PROGRESS" }) : json({})));
    vi.useFakeTimers();
    const ci = reel("Reel chậm");
    const job = jobOf(ci, igChan);
    const run = runPublishJob(job.id);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await run;
    vi.useRealTimers();
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("scheduled");
    expect(j.error).toMatch(/tự thử lại/);
    expect(j.platform_state).toMatchObject({ containerId: "CONT1", processingTries: 1 });
    expect(q.all("SELECT run_at FROM job WHERE name = 'publish.run' AND idempotency_key LIKE 'pubretry-auto:%'")).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("bài chỉ có chữ → lỗi rõ ràng, chưa đăng gì", async () => {
    const ci = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "instagram", title: "Chỉ chữ", body: "chỉ có chữ", status: "approved" });
    const job = jobOf(ci, igChan);
    await runPublishJob(job.id).catch(() => undefined);
    expect(byId<Row>("publish_job", job.id)).toMatchObject({ status: "failed" });
    expect(byId<Row>("publish_job", job.id)!.error).toMatch(/cần ảnh hoặc video/);
  });
});

describe("TikTok qua API", () => {
  const tt = (c: Call) => {
    if (c.url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
    if (c.url.endsWith("/post/publish/video/init/")) return json({ data: { publish_id: "p_77", upload_url: "https://upload.tiktok/put/9" }, error: { code: "ok" } });
    if (c.url.endsWith("/inbox/video/init/")) return json({ data: { publish_id: "p_inbox", upload_url: "https://upload.tiktok/put/10" }, error: { code: "ok" } });
    if (c.method === "PUT") return new Response(null, { status: 201 });
    if (c.url.includes("status/fetch")) return new Response('{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}', { status: 200 });
    return json({});
  };
  const tiktokReel = (title: string) => reel(title, { channel: "tiktok" });

  it("chưa duyệt + Chrome chưa sẵn sàng → needs_setup (kèm lý do TikTok), không gọi TikTok, bài vẫn 'đã duyệt'", async () => {
    stub(tt);
    const ci = tiktokReel("TT chưa duyệt");
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id).catch(() => undefined);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("needs_setup");
    expect(j.error).toMatch(/TikTok duyệt/);
    expect(calls).toHaveLength(0);
    expect(byId<Row>("content_item", ci.id)!.status).toBe("approved");
  });

  it("đã duyệt: đăng qua API; tài khoản chỉ cho riêng tư → ghi chú vào bài + cảnh báo (không im lặng); id không phải số → bỏ qua số liệu, không số 0 giả", async () => {
    update("connection", ttConn.id, { config: { ...ttConn.config, audited: "1" } });
    stub(tt);
    vi.useFakeTimers();
    const ci = tiktokReel("TT đã duyệt");
    const job = schedulePublish(B, ci.id, { now: true })!;
    const run = runPublishJob(job.id);
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
    vi.useRealTimers();
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("done");
    expect(j.platform_state).toMatchObject({ publishId: "p_77" });
    const post = byId<Row>("post", j.post_id)!;
    expect(post.meta.note).toMatch(/RIÊNG TƯ|riêng tư|hộp thư/i);
    expect(q.get("SELECT id FROM outbox WHERE type = 'alert.raised' AND payload LIKE '%postnote:%'")).toBeTruthy();
    expect(maybeCreateCandidate(post, 99, false, [])).toBeNull(); // id không phải mã video số → không ứng viên quảng cáo
    // số liệu: bài chưa có mã video công khai → không ghi snapshot
    const before = calls.length;
    await snapshotPost(post.id, "24h");
    expect(calls.length).toBe(before); // không gọi video/query
    expect(q.all("SELECT id FROM post_metric_snapshot WHERE post_id = ?", post.id)).toHaveLength(0);
    expect(q.get("SELECT id FROM audit_log WHERE event = 'post.snapshot_skipped'")).toBeTruthy();
  });

  it("bản nháp video: vào hộp thư TikTok qua API dù app chưa duyệt (không cần Chrome)", async () => {
    stub(tt);
    const ci = tiktokReel("TT nháp");
    update("content_item", ci.id, { status: "awaiting_approval" });
    const job = insert("creative_job", { biz_id: B, tool: "auto-video", title: "TT nháp", status: "approved", input: { channels: ["tiktok"], tool: "auto-video", title: "TT nháp", brief: "x", brand: "other" }, content_item_id: ci.id, asset_id: ci.asset_id, workdir: tmp });
    const made = scheduleDrafts(B, job.id, "ceo");
    expect(made).toHaveLength(1);
    expect(q.get<Row>("SELECT lock_key FROM job WHERE name = 'publish.draft'")!.lock_key).toBeNull();
    await runDraftUpload(made[0]);
    const pj = byId<Row>("publish_job", made[0])!;
    expect(pj).toMatchObject({ status: "draft_uploaded", simulated: 0 });
    expect(pj.draft_url).toMatch(/tiktok\.com/);
    expect(calls.some((c) => c.url.endsWith("/inbox/video/init/"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/post/publish/video/init/"))).toBe(false); // không đăng công khai
    expect(byId<Row>("content_item", ci.id)!.status).toBe("draft_on_channel");
  });
});
