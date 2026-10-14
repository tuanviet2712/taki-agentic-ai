import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../errors.ts";
import { instagramConnector } from "./instagram.ts";

/** Instagram Content Publishing: container → chờ xử lý → media_publish; id lưu để chạy lại không đăng trùng; token ở header. */
type Call = { url: string; method: string; auth: string; body: string };
let calls: Call[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function stub(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""), body: String(init?.body ?? "") };
    calls.push(c);
    return handler(c);
  }));
}
afterEach(() => vi.unstubAllGlobals());
const video = { path: "a.mp4", mime: "video/mp4", publicUrl: "https://link.taki.vn/m/tok" };
const ig = () => instagramConnector("PAGE_TOKEN", "IG1", { pollMs: 0, maxPolls: 3 });

describe("đăng Instagram", () => {
  it("Reels: tạo container (video_url công khai) → FINISHED → media_publish; id được báo qua onPending; token chỉ ở header", async () => {
    stub((c) => {
      if (c.method === "POST" && c.url.endsWith("/IG1/media")) return json({ id: "CONT1" });
      if (c.url.includes("/CONT1?")) return json({ status_code: "FINISHED" });
      if (c.method === "POST" && c.url.endsWith("/IG1/media_publish")) return json({ id: "MEDIA1" });
      if (c.url.includes("/MEDIA1?")) return json({ permalink: "https://www.instagram.com/reel/abc/" });
      return json({});
    });
    const pending: Record<string, unknown>[] = [];
    const r = await ig().publishPost!({ channelExternalId: "IG1", text: "Caption", kind: "reel", media: video, onPending: (s) => pending.push(s) }, "k");
    expect(r).toEqual({ externalId: "MEDIA1", permalink: "https://www.instagram.com/reel/abc/" });
    const create = new URLSearchParams(calls[0].body);
    expect(create.get("media_type")).toBe("REELS");
    expect(create.get("video_url")).toBe("https://link.taki.vn/m/tok");
    expect(create.get("caption")).toBe("Caption");
    expect(calls.every((c) => c.auth === "Bearer PAGE_TOKEN" && !c.url.includes("PAGE_TOKEN"))).toBe(true);
    expect(pending).toEqual([{ containerId: "CONT1" }, { containerId: "CONT1", mediaId: "MEDIA1" }]);
  });

  it("ảnh dùng image_url", async () => {
    stub((c) => (c.url.endsWith("/IG1/media") ? json({ id: "C" }) : c.url.includes("/C?") ? json({ status_code: "FINISHED" }) : c.url.endsWith("/media_publish") ? json({ id: "M" }) : json({ permalink: "https://instagram.com/p/x" })));
    await ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "image", media: { path: "a.jpg", mime: "image/jpeg", publicUrl: "https://link.taki.vn/m/t2" } }, "k");
    const create = new URLSearchParams(calls[0].body);
    expect(create.get("image_url")).toBe("https://link.taki.vn/m/t2");
    expect(create.get("media_type")).toBeNull();
  });

  it("chạy lại: có mediaId → chỉ hỏi permalink (1 lời gọi, không container / publish mới); có containerId → không tạo container mới", async () => {
    stub(() => json({ permalink: "https://www.instagram.com/reel/abc/" }));
    const r = await ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: video, resume: { containerId: "C1", mediaId: "M1" } }, "k");
    expect(r.externalId).toBe("M1");
    expect(calls).toHaveLength(1);

    stub((c) => (c.url.includes("/C1?") ? json({ status_code: "FINISHED" }) : c.url.endsWith("/media_publish") ? json({ id: "M2" }) : json({ permalink: "p" })));
    await ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: video, resume: { containerId: "C1" } }, "k");
    expect(calls.some((c) => c.url.endsWith("/IG1/media"))).toBe(false);
    expect(new URLSearchParams(calls.find((c) => c.url.endsWith("/media_publish"))!.body).get("creation_id")).toBe("C1");
  });

  it("thiếu link công khai → NeedsBrowser (chưa gọi mạng); chỉ chữ → InvalidRequest; bản nháp → NeedsBrowser", async () => {
    stub(() => json({}));
    await expect(ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: { path: "a.mp4", mime: "video/mp4" } }, "k")).rejects.toMatchObject({ kind: "NeedsBrowser" });
    await expect(ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "image" }, "k")).rejects.toMatchObject({ kind: "InvalidRequest" });
    await expect(ig().uploadDraft!({ channelExternalId: "IG1", videoPath: "a.mp4", caption: "x" }, "k")).rejects.toMatchObject({ kind: "NeedsBrowser" });
    expect(calls).toHaveLength(0);
  });

  it("container ERROR → InvalidRequest có lý do + xoá containerId; xử lý quá lâu → Transient 'resumable' (không tạo bài mới)", async () => {
    stub((c) => (c.url.endsWith("/IG1/media") ? json({ id: "C9" }) : json({ status_code: "ERROR", status: "Error: Media upload has failed with error code 2207026" })));
    const pending: Record<string, unknown>[] = [];
    await expect(ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: video, onPending: (s) => pending.push(s) }, "k")).rejects.toThrow(/xử lý media lỗi/);
    expect(pending.at(-1)).toEqual({ containerId: null });

    stub((c) => (c.url.endsWith("/IG1/media") ? json({ id: "C9" }) : json({ status_code: "IN_PROGRESS" })));
    const err = await ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: video }, "k").catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err).toMatchObject({ kind: "Transient", resumable: true });
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("mạng mất lúc media_publish → không rõ kết quả (outcomeUnknown), KHÔNG tự đăng lại", async () => {
    stub((c) => {
      if (c.url.endsWith("/IG1/media")) return json({ id: "C1" });
      if (c.url.includes("/C1?")) return json({ status_code: "FINISHED" });
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const err = await ig().publishPost!({ channelExternalId: "IG1", text: "x", kind: "reel", media: video }, "k").catch((e) => e);
    expect(err).toMatchObject({ outcomeUnknown: true });
  });

  it("bình luận + số liệu", async () => {
    stub((c) => {
      if (c.method === "POST" && c.url.endsWith("/M1/comments")) return json({ id: "cm1" });
      if (c.url.includes("/M1/insights")) return json({ data: [{ name: "reach", values: [{ value: 900 }] }, { name: "saved", values: [{ value: 4 }] }, { name: "shares", values: [{ value: 2 }] }] });
      return json({ like_count: 30, comments_count: 5 });
    });
    const c = ig();
    expect(await c.postComment!({ postExternalId: "M1", text: "Link ở bio" }, "k")).toEqual({ externalId: "cm1" });
    expect(await c.fetchPostMetrics!({ externalId: "M1", publishedAt: "", kind: "reel" }, "24h")).toEqual({ reach: 900, reactions: 30, comments: 5, shares: 2, saves: 4 });
  });
});
