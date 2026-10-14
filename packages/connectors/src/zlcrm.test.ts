import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError, live } from "./index.ts";

/** Client ZL-CRM (kết bạn theo SĐT): 503 = thử lại, 4xx = từ chối hẳn (giữ mã), không-có-Zalo chỉ khi server nói rõ. */
const creds = { base_url: "https://zl.example", api_key: "k" };
const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as any));

afterEach(() => vi.unstubAllGlobals());

async function caught(p: Promise<unknown>) {
  try { await p; } catch (e) { return e as live.ZlcrmError; }
  throw new Error("không ném lỗi");
}

describe("zlcrmFindUserByPhone", () => {
  it("503 SESSION_EXPIRED → ZlcrmError Transient retryable, giữ mã (không phải 'không có Zalo')", async () => {
    mockFetch(503, { error: "SESSION_EXPIRED", code: "SESSION_EXPIRED", message: "Phiên đăng nhập Zalo đã hết hạn" });
    const e = await caught(live.zlcrmFindUserByPhone(creds, { zaloAccountId: "za-1", phone: "84912345678" }));
    expect(e).toBeInstanceOf(ConnectorError);
    expect(live.isZlcrmError(e)).toBe(true);
    expect(e.kind).toBe("Transient");
    expect(e.code).toBe("SESSION_EXPIRED");
    expect(e.retryable).toBe(true);
  });

  it("503 ZALO_UNAVAILABLE → Transient; 503 RATE_LIMITED → RateLimited", async () => {
    mockFetch(503, { code: "ZALO_UNAVAILABLE", message: "Zalo tạm thời không phản hồi" });
    const e1 = await caught(live.zlcrmFindUserByPhone(creds, { zaloAccountId: "za-1", phone: "84912345678" }));
    expect([e1.kind, e1.code, e1.retryable]).toEqual(["Transient", "ZALO_UNAVAILABLE", true]);
    mockFetch(503, { code: "RATE_LIMITED", message: "giới hạn" });
    const e2 = await caught(live.zlcrmFindUserByPhone(creds, { zaloAccountId: "za-1", phone: "84912345678" }));
    expect([e2.kind, e2.retryable]).toEqual(["RateLimited", true]);
  });

  it("200 found=false/no_zalo → không có Zalo (không ném lỗi)", async () => {
    mockFetch(200, { found: false, uid: null, reason: "no_zalo" });
    expect(await live.zlcrmFindUserByPhone(creds, { zaloAccountId: "za-1", phone: "84912345678" })).toMatchObject({ found: false, reason: "no_zalo" });
  });
});

describe("zlcrmSendFriendRequest", () => {
  it("4xx từ chối hẳn → ZlcrmError không retry, giữ mã", async () => {
    mockFetch(403, { code: "FRIEND_REQUEST_BLOCKED", message: "Khách đã chặn nick này" });
    const e = await caught(live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: "hi" }));
    expect(e.code).toBe("FRIEND_REQUEST_BLOCKED");
    expect(e.status).toBe(403);
    expect(e.kind).toBe("PolicyRejected");
    expect(e.retryable).toBe(false);
    mockFetch(404, { code: "ZALO_USER_NOT_FOUND", message: "Không tìm thấy" });
    const e2 = await caught(live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: "hi" }));
    expect([e2.kind, e2.code, e2.retryable]).toEqual(["NotFound", "ZALO_USER_NOT_FOUND", false]);
  });

  it("503 → Transient retryable", async () => {
    mockFetch(503, { code: "ZALO_UNAVAILABLE", message: "x" });
    const e = await caught(live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: "hi" }));
    expect([e.kind, e.retryable]).toEqual(["Transient", true]);
  });

  it("trả sentMessage đúng lời chào server đã gửi; server cũ không trả → tự cắt 150 ký tự", async () => {
    mockFetch(201, { sent: true, uid: "u-1", sentMessage: "Chào chị" });
    expect(await live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: "Chào chị ơi, rất dài" })).toMatchObject({ sent: true, uid: "u-1", sentMessage: "Chào chị" });
    mockFetch(201, { sent: true, uid: "u-1" });
    const long = "x".repeat(300);
    expect((await live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: long })).sentMessage).toHaveLength(150);
    mockFetch(200, { sent: false, uid: "u-1", alreadyFriend: true, sentMessage: null });
    expect(await live.zlcrmSendFriendRequest(creds, { zaloAccountId: "za-1", userId: "u-1", message: "hi" })).toMatchObject({ sent: false, alreadyFriend: true, sentMessage: null });
  });
});
