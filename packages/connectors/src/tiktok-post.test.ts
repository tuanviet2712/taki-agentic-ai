import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tiktokError, tiktokPostConnector, tiktokPostTest } from "./tiktok-post.ts";

/** TikTok Content Posting: bản nháp (hộp thư) luôn dùng được; đăng công khai CHỈ khi app được đánh dấu đã duyệt; không số liệu giả. */
type Call = { url: string; method: string; auth: string; body: string; headers: Record<string, string> };
let calls: Call[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const text = (s: string, status = 200) => new Response(s, { status });
function stub(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), auth: String(headers.authorization ?? ""), body: init?.body instanceof Buffer ? "<bytes>" : String(init?.body ?? ""), headers };
    calls.push(c);
    return handler(c);
  }));
}
let tmp: string, file: string;
beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), "taki-tt-")); file = join(tmp, "v.mp4"); writeFileSync(file, Buffer.alloc(2048, 7)); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());
const tt = (o: { audited?: boolean } = {}) => tiktokPostConnector(async () => "TOK", { pollMs: 0, maxPolls: 3, ...o });
const video = () => ({ path: file, mime: "video/mp4" });

describe("TikTok đăng video", () => {
  it("app CHƯA được duyệt: không gọi mạng, không đăng riêng tư âm thầm → NeedsBrowser", async () => {
    stub(() => json({}));
    await expect(tt().publishPost!({ channelExternalId: "o1", text: "x", kind: "reel", media: video() }, "k")).rejects.toMatchObject({ kind: "NeedsBrowser" });
    expect(calls).toHaveLength(0);
  });

  it("bản nháp: init inbox + PUT tệp, chỉ cần video.upload (kể cả chưa duyệt)", async () => {
    stub((c) => {
      if (c.url.endsWith("/post/publish/inbox/video/init/")) return json({ data: { publish_id: "p_inbox", upload_url: "https://upload.tiktok/put/1" }, error: { code: "ok" } });
      return new Response(null, { status: 201 });
    });
    const r = await tt().uploadDraft!({ channelExternalId: "o1", videoPath: file, caption: "c" }, "k");
    expect(r.externalId).toBe("p_inbox");
    const init = JSON.parse(calls[0].body);
    expect(init.source_info).toMatchObject({ source: "FILE_UPLOAD", video_size: 2048, chunk_size: 2048, total_chunk_count: 1 });
    expect(calls[0].auth).toBe("Bearer TOK");
    const put = calls[1];
    expect(put.method).toBe("PUT");
    expect(put.headers["content-range"]).toBe("bytes 0-2047/2048");
  });

  it("đã duyệt: creator_info → init → PUT → trạng thái; tài khoản chỉ cho riêng tư thì có CẢNH BÁO (note), id 64-bit giữ nguyên", async () => {
    stub((c) => {
      if (c.url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
      if (c.url.endsWith("/post/publish/video/init/")) return json({ data: { publish_id: "p_1", upload_url: "https://upload.tiktok/put/2" }, error: { code: "ok" } });
      if (c.method === "PUT") return new Response(null, { status: 201 });
      return text('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]},"error":{"code":"ok"}}');
    });
    const pending: Record<string, unknown>[] = [];
    const r = await tt({ audited: true }).publishPost!({ channelExternalId: "o1", text: "Caption", kind: "reel", media: video(), onPending: (s) => pending.push(s) }, "k");
    expect(r.externalId).toBe("7412345678901234567");
    expect(r.permalink).toBe("https://www.tiktok.com/video/7412345678901234567");
    expect(r.note).toMatch(/RIÊNG TƯ/);
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/video/init/"))!.body).post_info.privacy_level).toBe("SELF_ONLY");
    expect(pending[0]).toMatchObject({ publishId: "p_1" });
  });

  it("đã duyệt + tài khoản cho công khai → PUBLIC_TO_EVERYONE, không note", async () => {
    stub((c) => {
      if (c.url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] }, error: { code: "ok" } });
      if (c.url.endsWith("/video/init/")) return json({ data: { publish_id: "p_2", upload_url: "https://upload.tiktok/put/3" }, error: { code: "ok" } });
      if (c.method === "PUT") return new Response(null, { status: 201 });
      return text('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7400000000000000001]},"error":{"code":"ok"}}');
    });
    const r = await tt({ audited: true }).publishPost!({ channelExternalId: "o1", text: "x", kind: "reel", media: video() }, "k");
    expect(r.note).toBeUndefined();
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/video/init/"))!.body).post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
  });

  it("chạy lại có publish_id → chỉ hỏi trạng thái (không tải lại); xử lý quá lâu → Transient 'resumable'", async () => {
    stub(() => text('{"data":{"status":"PROCESSING_UPLOAD"},"error":{"code":"ok"}}'));
    const err = await tt({ audited: true }).publishPost!({ channelExternalId: "o1", text: "x", kind: "reel", media: video(), resume: { publishId: "p_1" } }, "k").catch((e) => e);
    expect(err).toMatchObject({ kind: "Transient", resumable: true });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.url.includes("status/fetch"))).toBe(true);
  });

  it("mất kết nối giữa lúc tải → outcomeUnknown (không tự đăng lại)", async () => {
    stub((c) => {
      if (c.url.endsWith("/inbox/video/init/")) return json({ data: { publish_id: "p", upload_url: "https://upload.tiktok/put/4" }, error: { code: "ok" } });
      throw Object.assign(new Error("socket hang up"), {});
    });
    const err = await tt().uploadDraft!({ channelExternalId: "o1", videoPath: file, caption: "c" }, "k").catch((e) => e);
    expect(err).toMatchObject({ kind: "InvalidRequest", outcomeUnknown: true });
    expect(err.message).toMatch(/TikTok Studio/);
  });

  it("số liệu: bài chưa có mã video → NotFound (không ghi số 0 giả); có mã → số thật; không thấy video → NotFound", async () => {
    stub(() => json({ data: { videos: [{ id: "7400000000000000001", view_count: 1200, like_count: 80, comment_count: 6, share_count: 3 }] }, error: { code: "ok" } }));
    const c = tt();
    await expect(c.fetchPostMetrics!({ externalId: "v_pub_file~v2.123", publishedAt: "", kind: "reel" }, "24h")).rejects.toMatchObject({ kind: "NotFound" });
    expect(calls).toHaveLength(0);
    expect(await c.fetchPostMetrics!({ externalId: "7400000000000000001", publishedAt: "", kind: "reel" }, "24h")).toEqual({ reach: 1200, reactions: 80, comments: 6, shares: 3, saves: 0 });
    stub(() => json({ data: { videos: [] }, error: { code: "ok" } }));
    await expect(tt().fetchPostMetrics!({ externalId: "7400000000000000009", publishedAt: "", kind: "reel" }, "24h")).rejects.toMatchObject({ kind: "NotFound" });
  });

  it("dịch lỗi + kiểm tra tài khoản", async () => {
    expect(tiktokError("unaudited_client_can_only_post_to_private_accounts", "").kind).toBe("PolicyRejected");
    expect(tiktokError("spam_risk_too_many_posts", "").kind).toBe("RateLimited");
    expect(tiktokError("access_token_invalid", "").kind).toBe("AuthError");
    expect(tiktokError("something_new", "msg").message).toBe("TikTok: msg");
    stub(() => json({ data: { user: { open_id: "open1", display_name: "Kênh Lan" } }, error: { code: "ok" } }));
    expect(await tiktokPostTest({ access_token: "TOK" })).toEqual({ openId: "open1", name: "Kênh Lan" });
    expect(calls[0].auth).toBe("Bearer TOK");
  });
});
