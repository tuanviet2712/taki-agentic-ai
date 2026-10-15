import { describe, expect, it } from "vitest";
import { chuanDomainGui, diaChiGuiMacDinh, dmarcMacDinh, goiYDomainGui, headerHuyDangKy, sangCf, soSanhDns, tenDayDu, tenSpfResend } from "./ket-noi-email.ts";

describe("tên bản ghi Resend → tên đầy đủ", () => {
  it("domain gửi là gốc zone", () => {
    expect(tenDayDu("send", "certifiedai.net", "certifiedai.net")).toBe("send.certifiedai.net");
    expect(tenDayDu("resend._domainkey", "certifiedai.net", "certifiedai.net")).toBe("resend._domainkey.certifiedai.net");
    expect(tenDayDu("@", "certifiedai.net", "certifiedai.net")).toBe("certifiedai.net");
  });
  it("domain gửi là subdomain: Resend ghi tương đối với zone («send.mail») hoặc với domain («send»)", () => {
    expect(tenDayDu("send.mail", "mail.certifiedai.net", "certifiedai.net")).toBe("send.mail.certifiedai.net");
    expect(tenDayDu("resend._domainkey.mail", "mail.certifiedai.net", "certifiedai.net")).toBe("resend._domainkey.mail.certifiedai.net");
    expect(tenDayDu("send", "mail.certifiedai.net", "certifiedai.net")).toBe("send.mail.certifiedai.net");
    expect(tenDayDu("send.mail.certifiedai.net.", "mail.certifiedai.net", "certifiedai.net")).toBe("send.mail.certifiedai.net");
  });
  it("sangCf: MX mang priority, TXT thì không", () => {
    expect(sangCf({ record: "SPF", name: "send.mail", type: "MX", value: "feedback-smtp.ap-northeast-1.amazonses.com", priority: 10 }, "mail.x.vn", "x.vn"))
      .toEqual({ type: "MX", name: "send.mail.x.vn", content: "feedback-smtp.ap-northeast-1.amazonses.com", priority: 10 });
    expect(sangCf({ record: "DKIM", name: "resend._domainkey.mail", type: "TXT", value: "p=MIGf" }, "mail.x.vn", "x.vn")).not.toHaveProperty("priority");
  });
});

describe("soSanhDns: thêm / sửa / giữ — không bao giờ xoá", () => {
  const spf = { type: "TXT", name: "send.mail.x.vn", content: "v=spf1 include:amazonses.com ~all" };
  it("y hệt (Cloudflare trả TXT có nháy) → giữ", () => {
    expect(soSanhDns(spf, [{ id: "1", type: "TXT", name: "send.mail.x.vn", content: "\"v=spf1 include:amazonses.com ~all\"" }]).loai).toBe("giu");
  });
  it("SPF cũ khác giá trị → sửa đúng bản ghi SPF, không đụng TXT khác cùng tên", () => {
    const v = soSanhDns(spf, [
      { id: "khac", type: "TXT", name: "send.mail.x.vn", content: "google-site-verification=abc" },
      { id: "spfcu", type: "TXT", name: "send.mail.x.vn", content: "v=spf1 include:mailgun.org ~all" },
    ]);
    expect(v).toMatchObject({ loai: "sua", cuId: "spfcu" });
  });
  it("chưa có → thêm; MX khác → thêm (nhiều MX hợp lệ)", () => {
    expect(soSanhDns(spf, []).loai).toBe("them");
    const mx = { type: "MX", name: "send.mail.x.vn", content: "feedback-smtp.amazonses.com", priority: 10 };
    expect(soSanhDns(mx, [{ id: "m", type: "MX", name: "send.mail.x.vn", content: "mx.khac.com", priority: 10 }]).loai).toBe("them");
    expect(soSanhDns(mx, [{ id: "m", type: "MX", name: "send.mail.x.vn", content: "feedback-smtp.amazonses.com.", priority: 10 }]).loai).toBe("giu");
  });
});

describe("DMARC, địa chỉ, header", () => {
  it("subdomain riêng → quarantine (qua kiểm của app); domain gốc → none (không làm rơi thư Gmail/Workspace)", () => {
    expect(dmarcMacDinh("mail.x.vn", "x.vn")).toMatchObject({ name: "_dmarc.mail.x.vn", content: expect.stringContaining("p=quarantine") });
    expect(dmarcMacDinh("x.vn", "x.vn").content).toContain("p=none");
  });
  it("gợi ý và chuẩn hoá", () => {
    expect(goiYDomainGui("app.certifiedai.net")).toBe("mail.certifiedai.net");
    expect(goiYDomainGui(null)).toBe("");
    expect(chuanDomainGui("https://Mail.CertifiedAI.net/")).toEqual({ ok: true, domain: "mail.certifiedai.net", zone: "certifiedai.net" });
    expect(chuanDomainGui("khong hop le").ok).toBe(false);
    expect(diaChiGuiMacDinh("Hello", "mail.x.vn")).toBe("hello@mail.x.vn");
    expect(diaChiGuiMacDinh("có dấu", "mail.x.vn")).toBeNull();
    expect(tenSpfResend("mail.x.vn")).toBe("send.mail.x.vn");
  });
  it("header hủy một chạm theo RFC 8058", () => {
    expect(headerHuyDangKy("https://app.x.vn/api/huy-nhan/abc")).toEqual({
      "List-Unsubscribe": "<https://app.x.vn/api/huy-nhan/abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
