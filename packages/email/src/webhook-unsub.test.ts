import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { kiemSvix } from "./chu-ky-webhook.ts";
import { makeUnsubToken, readUnsubToken } from "./unsubscribe.ts";
import { phanBan } from "./ab.ts";
import { gioGuiHopLe } from "./luong.ts";

describe("chữ ký webhook Resend (svix)", () => {
  const than = '{"type":"email.bounced"}';
  const secret = "whsec_" + Buffer.from("khoa-bi-mat").toString("base64");
  const id = "msg_1", ts = "1757000000";
  const chuKy = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${than}`).digest("base64");
  const goc = { thanRaw: than, id, timestamp: ts, secret, bayGioMs: 1757000000_000 };
  it("đúng chữ ký thì qua, sai thì chặn", () => {
    expect(kiemSvix({ ...goc, header: `v1,${chuKy}` }).dat).toBe(true);
    expect(kiemSvix({ ...goc, header: `v1,saisai v1,${chuKy}` }).dat).toBe(true);
    expect(kiemSvix({ ...goc, header: "v1,saisai" }).dat).toBe(false);
    expect(kiemSvix({ ...goc, header: `v1,${chuKy}`, thanRaw: than + " " }).dat).toBe(false);
  });
  it("timestamp lệch quá 5 phút bị chặn (chống phát lại)", () => {
    const kq = kiemSvix({ ...goc, header: `v1,${chuKy}`, bayGioMs: 1757000000_000 + 6 * 60_000 });
    expect(kq.dat).toBe(false);
    expect(kq.lyDo).toMatch(/phát lại/);
  });
});

describe("token hủy nhận", () => {
  it("đọc lại đúng, sửa 1 ký tự là hỏng, khoá khác là hỏng", () => {
    const t = makeUnsubToken("biz1", "c1", "k");
    expect(readUnsubToken(t, "k")).toEqual({ bizId: "biz1", contactId: "c1" });
    expect(readUnsubToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), "k")).toBeNull();
    expect(readUnsubToken(t, "k2")).toBeNull();
    expect(readUnsubToken("rac", "k")).toBeNull();
  });
});

describe("A/B + khung giờ gửi", () => {
  it("chia bản tất định, tỉ lệ gần đúng", () => {
    expect(phanBan("u1", "e", 50)).toBe(phanBan("u1", "e", 50));
    const b = Array.from({ length: 2000 }, (_, i) => phanBan(`u${i}`, "e", 30)).filter((x) => x === "b").length;
    expect(b).toBeGreaterThan(450);
    expect(b).toBeLessThan(750);
  });
  it("ngoài 8h–21h giờ VN thì dồn sang 8h", () => {
    const dem = new Date("2026-10-15T16:00:00Z"); // 23:00 VN
    expect(gioGuiHopLe(dem).toISOString()).toBe("2026-10-16T01:00:00.000Z");
    const sang = new Date("2026-10-15T22:00:00Z"); // 05:00 VN ngày 16
    expect(gioGuiHopLe(sang).toISOString()).toBe("2026-10-16T01:00:00.000Z");
    const trua = new Date("2026-10-15T05:00:00Z");
    expect(gioGuiHopLe(trua)).toEqual(trua);
  });
});
