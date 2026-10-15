// Đợt F (phần 2) — Email builder theo khối: kiểm JSON, 10 mẫu hệ thống, render ra HTML bảng (Outlook an toàn),
// footer hủy nhận bắt buộc, biến thay đúng (cả lúc render lẫn qua đường cá nhân hoá của gui-tin).
import { describe, expect, it } from "vitest";
import { renderCaNhan } from "./email.ts";
import {
  BIEN_EMAIL, bocLinkHtml, coCta, khoiSangVanBan, kiemNoiDungKhoi, laHtmlDayDu, laUrlNguyHiem,
  themFooterBatBuoc, trichUrlHtml, vanBanSangKhoi, type KhoiJson,
} from "./email-khoi.ts";
import { thayBien } from "./luong.ts";
import { MAU_EMAIL_KHOI, NHOM_MAU_KHOI } from "./mau-email-khoi.ts";
import { MAU_EMAIL_LE } from "./mau-email-le.ts";
import { renderEmailKhoi } from "./render-khoi.ts";

const doan = (t: string): KhoiJson => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const docTest = (...c: KhoiJson[]): KhoiJson => ({ type: "doc", content: c });

describe("kiemNoiDungKhoi", () => {
  it("bắt JSON rỗng / không phải doc", () => {
    expect(kiemNoiDungKhoi(null).ok).toBe(false);
    expect(kiemNoiDungKhoi({ type: "paragraph" }).ok).toBe(false);
    const rong = kiemNoiDungKhoi(docTest({ type: "paragraph", content: [] }));
    expect(rong.ok).toBe(false);
    expect(rong.loi[0]).toMatch(/trống/i);
    expect(kiemNoiDungKhoi(docTest(doan("   "))).ok).toBe(false);
  });
  it("bắt link javascript: ở link mark, nút và ảnh (kể cả chèn khoảng trắng)", () => {
    const link = docTest({ type: "paragraph", content: [{ type: "text", text: "bấm", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] });
    expect(kiemNoiDungKhoi(link).ok).toBe(false);
    expect(kiemNoiDungKhoi(link).loi.join(" ")).toMatch(/không an toàn/);
    const nut = docTest(doan("x"), { type: "button", attrs: { text: "Đi", url: "java\nscript:void(0)" } });
    expect(kiemNoiDungKhoi(nut).ok).toBe(false);
    const anh = docTest(doan("x"), { type: "image", attrs: { src: "https://ok.vn/a.png", externalLink: "DATA:text/html,x" } });
    expect(kiemNoiDungKhoi(anh).ok).toBe(false);
    expect(laUrlNguyHiem("https://taki.vn")).toBe(false);
    expect(laUrlNguyHiem("mailto:a@b.vn")).toBe(false);
  });
  it("biến lạ không có dự phòng → lỗi; biến trong danh sách → hợp lệ", () => {
    const la = docTest({ type: "paragraph", content: [{ type: "variable", attrs: { id: "ma_don" } }, { type: "text", text: "x" }] });
    expect(kiemNoiDungKhoi(la).ok).toBe(false);
    const laDuPhong = docTest({ type: "paragraph", content: [{ type: "variable", attrs: { id: "ma_don", fallback: "—" } }, { type: "text", text: "x" }] });
    expect(kiemNoiDungKhoi(laDuPhong).ok).toBe(true);
    const hopLe = docTest({ type: "paragraph", content: [{ type: "variable", attrs: { id: "ho_ten" } }, { type: "text", text: "x" }] });
    expect(kiemNoiDungKhoi(hopLe).ok).toBe(true);
    const thieuTen = docTest({ type: "paragraph", content: [{ type: "variable", attrs: {} }, { type: "text", text: "x" }] });
    expect(kiemNoiDungKhoi(thieuTen).ok).toBe(false);
  });
  it("danh sách biến có ho_ten, ten, ten_thuong_hieu, link_huy_nhan", () => {
    const ma = BIEN_EMAIL.map((b) => b.ma);
    for (const b of ["ho_ten", "ten", "email", "ten_thuong_hieu", "link_huy_nhan"]) expect(ma).toContain(b);
  });
});

describe("10 mẫu email khối hệ thống", () => {
  it("đủ 10 mẫu, mã duy nhất, nhóm hợp lệ", () => {
    expect(MAU_EMAIL_KHOI).toHaveLength(10);
    expect(new Set(MAU_EMAIL_KHOI.map((m) => m.ma)).size).toBe(10);
    const nhom = new Set(NHOM_MAU_KHOI.map((n) => n.ma));
    for (const m of MAU_EMAIL_KHOI) expect(nhom.has(m.nhom)).toBe(true);
    for (const ma of ["chao-mung", "tang-tai-lieu", "moi-webinar", "nhac-webinar-1h", "mo-ban", "dong-ban-24h", "sau-mua", "ban-tin", "phuc-hoi-gio-hang", "xin-danh-gia"]) {
      expect(MAU_EMAIL_KHOI.some((m) => m.ma === ma)).toBe(true);
    }
  });
  it("mỗi mẫu qua kiểm, không có gạch ngang dài, có CTA, không hứa thu nhập", () => {
    for (const m of MAU_EMAIL_KHOI) {
      const kiem = kiemNoiDungKhoi(m.noiDungKhoi);
      expect(kiem.loi, m.ma).toEqual([]);
      const chu = `${m.tieuDe} ${m.preheader} ${khoiSangVanBan(m.noiDungKhoi)}`;
      expect(chu, m.ma).not.toContain("—");
      expect(coCta(m.noiDungKhoi), m.ma).toBe(true);
      expect(chu, m.ma).not.toMatch(/cam kết (thu nhập|lợi nhuận)|x\d+ doanh thu|giàu nhanh/i);
      expect(chu.length, m.ma).toBeGreaterThan(200);
    }
  });
});

describe("renderEmailKhoi → HTML Outlook an toàn", () => {
  const mau = MAU_EMAIL_KHOI[0];
  it("ra bảng, không flex/grid, có khối MSO, có footer hủy nhận, thay {{ho_ten}}", async () => {
    const html = await renderEmailKhoi(mau.noiDungKhoi, {
      tenGui: "TAKI Academy", preheader: mau.preheader, linkHuyNhan: "https://x.vn/api/huy-nhan/abc",
      bien: { ho_ten: "Kiểm", ten_thuong_hieu: "TAKI Academy" },
    });
    expect(laHtmlDayDu(html)).toBe(true);
    expect(html).toContain("<table");
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("Hủy đăng ký tại đây");
    expect(html).toContain('href="https://x.vn/api/huy-nhan/abc"');
    expect(html).toContain("Chào <!-- -->Kiểm");
    expect(html).not.toContain("{{ho_ten");
    expect(html).toContain('lang="vi"');
  });
  it("không truyền biến → giữ cú pháp {{ten|dự phòng}} để gui-tin cá nhân hoá; footer idempotent", async () => {
    const html = await renderEmailKhoi(mau.noiDungKhoi, { tenGui: "TAKI Academy" });
    expect(html).toContain("{{ho_ten|anh/chị}}");
    expect(html).toContain('href="{{link_huy_nhan}}"');
    // Đường của gui-tin: renderCaNhan (F-025) + thayBien, rồi footer đã có thì không chèn lần hai
    const bien = { ho_ten: "Kiểm", link_huy_nhan: "https://x.vn/api/huy-nhan/tok", ten_thuong_hieu: "TAKI" };
    const ra = thayBien(renderCaNhan(html, bien), bien);
    expect(ra).toContain("Kiểm");
    expect(ra).not.toContain("{{");
    expect(ra).toContain('href="https://x.vn/api/huy-nhan/tok"');
    const lai = themFooterBatBuoc(ra, { tenGui: "TAKI", linkHuyNhan: "https://khac" });
    expect(lai).toBe(ra);
    expect((lai.match(/Hủy đăng ký tại đây/g) ?? []).length).toBe(1);
  });
  it("biến {{ten}} được thay (kể cả suy từ ho_ten)", async () => {
    const json = docTest({ type: "paragraph", content: [{ type: "text", text: "Chào " }, { type: "variable", attrs: { id: "ten", fallback: "bạn" } }] });
    expect((await renderEmailKhoi(json, { tenGui: "TAKI", bien: { ten: "Kiểm" } }))).toContain("Kiểm");
    expect((await renderEmailKhoi(json, { tenGui: "TAKI", bien: { ho_ten: "Hoa" } }))).toContain("Hoa");
    expect((await renderEmailKhoi(json, { tenGui: "TAKI", bien: {} }))).toContain("bạn");
  });
  it("từ chối JSON không hợp lệ", async () => {
    await expect(renderEmailKhoi(docTest({ type: "paragraph", content: [] }), { tenGui: "TAKI" })).rejects.toThrow(/trống/);
  });
});

describe("bọc link trong HTML + văn bản ↔ khối", () => {
  it("chỉ đổi href http(s), bỏ link hủy nhận, giải &amp;", () => {
    const html = '<a href="https://taki.vn/a?x=1&amp;y=2">A</a> <a href="https://x.vn/api/huy-nhan/t">Hủy</a> <a href="mailto:a@b.vn">m</a>';
    expect(trichUrlHtml(html)).toEqual(["https://taki.vn/a?x=1&y=2"]);
    const ra = bocLinkHtml(html, (u) => `https://s.vn/l/${u.length}`);
    expect(ra).toContain('href="https://s.vn/l/25"');
    expect(ra).toContain('href="https://x.vn/api/huy-nhan/t"');
    expect(ra).toContain('href="mailto:a@b.vn"');
  });
  it("40 email lẻ chuyển sang khối đều hợp lệ; biến và URL thành node đúng loại", () => {
    for (const m of MAU_EMAIL_LE) expect(kiemNoiDungKhoi(vanBanSangKhoi(m.noiDung)).ok, m.ma).toBe(true);
    const k = vanBanSangKhoi("Chào {{ho_ten|bạn}},\nxem https://taki.vn nhé\n\nĐoạn hai");
    expect(k.content).toHaveLength(2);
    const inline = k.content![0].content!;
    expect(inline.some((n) => n.type === "variable" && n.attrs?.id === "ho_ten" && n.attrs?.fallback === "bạn")).toBe(true);
    expect(inline.some((n) => n.type === "hardBreak")).toBe(true);
    expect(inline.some((n) => n.marks?.[0]?.type === "link" && n.marks[0].attrs?.href === "https://taki.vn")).toBe(true);
    expect(khoiSangVanBan(k)).toContain("{{ho_ten|bạn}}");
  });
});
