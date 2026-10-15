// Đợt H (nhánh 5) — test logic thuần email KÉO THẢ: kiểm JSON (schema zod thư viện + javascript: + mồ côi + biến),
// thao tác cây bất biến, đọc biến, văn bản thuần, 10 mẫu hệ thống hợp lệ + render ra HTML bảng có footer,
// và timeline chuỗi: sapXepLaiViTri liên tục 0..n-1, doiChoNgay giữ tổng ngày tăng dần.
import { describe, expect, it } from "vitest";
import {
  BANG_KHOI, GOC, capNhatKhoi, chenKhoi, coCtaKeoTha, conChau, diChuyenKhoi, docBienTrongJson, docKeoThaTuChuoi, doiChoNgay, doiSoCot,
  keoThaSangVanBan, kiemJsonKeoTha, nhanBanKhoi, sapXepLaiViTri, taoKhoi, taoTaiLieuTrong, thuTuKhoi, timCha, tinhNgayTichLuy, xoaKhoi,
  type TaiLieuKeoTha,
} from "./email-keo-tha.ts";
import { MAU_EMAIL_KEO_THA } from "./mau-email-keo-tha.ts";
import { DAU_FOOTER } from "./email-khoi.ts";
import { renderEmailKeoTha } from "./render-khoi.ts";

/** Tài liệu mẫu: tiêu đề + cột 2 (nút ở cột 1) + đoạn văn. Id cố định để test dễ đọc. */
function docMau(): TaiLieuKeoTha {
  let d = taoTaiLieuTrong();
  d = chenKhoi(d, taoKhoi("tieu_de"), { chaId: GOC, cot: 0 }, "h").doc;
  d = chenKhoi(d, taoKhoi("cot_2"), { chaId: GOC, cot: 0 }, "cot").doc;
  d = chenKhoi(d, taoKhoi("nut"), { chaId: "cot", cot: 0 }, "nut").doc;
  d = chenKhoi(d, taoKhoi("doan_van"), { chaId: GOC, cot: 0 }, "p").doc;
  return d;
}

describe("bảng khối + tạo khối", () => {
  it("11 mục tiếng Việt, mỗi mục tạo được khối đúng type", () => {
    expect(BANG_KHOI.length).toBe(11);
    for (const m of BANG_KHOI) {
      const k = taoKhoi(m.ma);
      expect(k.type).toBeTruthy();
      expect(/^[A-Z]/.test(k.type)).toBe(true);
    }
    expect(taoKhoi("cot_3").data.props?.columnsCount).toBe(3);
    expect(taoKhoi("chan_trang").type).toBe("Text");
  });
});

describe("cây khối bất biến", () => {
  it("chèn vào root và vào cột; timCha đúng ngăn", () => {
    const d = docMau();
    expect(thuTuKhoi(d)).toEqual(["h", "cot", "nut", "p"]);
    expect(timCha(d, "nut")).toEqual({ chaId: "cot", cot: 0, viTri: 0 });
    expect(timCha(d, "p")).toEqual({ chaId: GOC, cot: 0, viTri: 2 });
    expect(timCha(d, GOC)).toBeNull();
  });
  it("diChuyenKhoi: root → cột 2, cột → root, cùng ngăn xuống dưới không lệch chỉ số, không kéo vào con cháu", () => {
    const d = docMau();
    const d1 = diChuyenKhoi(d, "p", { chaId: "cot", cot: 1, viTri: 0 });
    expect(thuTuKhoi(d1)).toEqual(["h", "cot", "nut", "p"]);
    expect(timCha(d1, "p")).toEqual({ chaId: "cot", cot: 1, viTri: 0 });
    expect((d1[GOC].data.childrenIds as string[])).toEqual(["h", "cot"]);
    const d2 = diChuyenKhoi(d1, "nut", { chaId: GOC, cot: 0, viTri: 0 });
    expect((d2[GOC].data.childrenIds as string[])).toEqual(["nut", "h", "cot"]);
    // cùng ngăn: kéo «nut» (vị trí 0) xuống sau «cot» (đích vị trí 3 = cuối) → nut cuối
    const d3 = diChuyenKhoi(d2, "nut", { chaId: GOC, cot: 0, viTri: 3 });
    expect((d3[GOC].data.childrenIds as string[])).toEqual(["h", "cot", "nut"]);
    // kéo cột vào chính con của nó → giữ nguyên
    const d4 = diChuyenKhoi(d1, "cot", { chaId: "cot", cot: 0, viTri: 0 });
    expect(d4).toBe(d1);
    expect(d).not.toBe(d1); // bất biến
    expect(thuTuKhoi(d)).toEqual(["h", "cot", "nut", "p"]);
  });
  it("xoaKhoi xoá cả con cháu; nhanBanKhoi sao sâu với id mới đặt ngay sau", () => {
    const d = docMau();
    const dx = xoaKhoi(d, "cot");
    expect(Object.keys(dx).sort()).toEqual(["h", "p", GOC].sort());
    const { doc: dn, id } = nhanBanKhoi(d, "cot");
    expect(id).not.toBe("cot");
    expect((dn[GOC].data.childrenIds as string[])[2]).toBe(id);
    expect(conChau(dn, id).length).toBe(1);
    expect(dn[conChau(dn, id)[0]].type).toBe("Button");
    expect(conChau(dn, id)[0]).not.toBe("nut");
  });
  it("capNhatKhoi gộp nông props/style; doiSoCot 3→2 dồn khối cột 3 về cột 2", () => {
    let d = docMau();
    d = capNhatKhoi(d, "nut", { props: { text: "Đăng ký" }, style: { textAlign: "center" } });
    expect(d.nut.data.props?.text).toBe("Đăng ký");
    expect(d.nut.data.props?.url).toBe("https://taki.vn");
    expect(d.nut.data.style?.textAlign).toBe("center");
    d = doiSoCot(d, "cot", 3);
    d = chenKhoi(d, taoKhoi("doan_van"), { chaId: "cot", cot: 2 }, "p3").doc;
    expect(timCha(d, "p3")?.cot).toBe(2);
    d = doiSoCot(d, "cot", 2);
    expect(timCha(d, "p3")).toEqual({ chaId: "cot", cot: 1, viTri: 0 });
    expect(kiemJsonKeoTha(d).ok).toBe(true);
  });
});

describe("kiemJsonKeoTha", () => {
  it("tài liệu mẫu hợp lệ; trống / thiếu root / JSON hỏng bị chặn", () => {
    expect(kiemJsonKeoTha(docMau()).ok).toBe(true);
    expect(kiemJsonKeoTha(taoTaiLieuTrong()).loi[0]).toMatch(/trống/);
    expect(kiemJsonKeoTha({ a: 1 }).loi[0]).toMatch(/root/);
    expect(kiemJsonKeoTha(null).ok).toBe(false);
    expect(docKeoThaTuChuoi("{oops")).toBeNull();
    expect(docKeoThaTuChuoi(JSON.stringify(docMau()))?.root.type).toBe("EmailLayout");
  });
  it("bắt link javascript: ở nút, link markdown trong đoạn văn, href trong HTML thô; script trong HTML", () => {
    const d1 = capNhatKhoi(docMau(), "nut", { props: { url: "java\nscript:alert(1)" } });
    expect(kiemJsonKeoTha(d1).loi.join(" ")).toMatch(/không an toàn/);
    const d2 = capNhatKhoi(docMau(), "p", { props: { text: "bấm [đây](javascript:void(0))" } });
    expect(kiemJsonKeoTha(d2).ok).toBe(false);
    const d3 = chenKhoi(docMau(), capNhatKhoi({ x: taoKhoi("html") }, "x", { props: { contents: '<a href="javascript:x">a</a>' } }).x, { chaId: GOC, cot: 0 }).doc;
    expect(kiemJsonKeoTha(d3).ok).toBe(false);
    const d4 = chenKhoi(docMau(), capNhatKhoi({ x: taoKhoi("html") }, "x", { props: { contents: "<script>1</script>" } }).x, { chaId: GOC, cot: 0 }).doc;
    expect(kiemJsonKeoTha(d4).loi.join(" ")).toMatch(/script/);
  });
  it("schema zod thư viện: màu sai định dạng, level lạ → lỗi có đường dẫn", () => {
    const d = capNhatKhoi(docMau(), "nut", { props: { buttonTextColor: "#fff" } });
    const kq = kiemJsonKeoTha(d);
    expect(kq.ok).toBe(false);
    expect(kq.loi[0]).toMatch(/nut.*màu/);
    expect(kiemJsonKeoTha(capNhatKhoi(docMau(), "h", { props: { level: "h9" } })).ok).toBe(false);
  });
  it("khối mồ côi, id thiếu, ảnh không URL, nút không link, biến lạ không dự phòng", () => {
    const moCoi = { ...docMau(), thua: taoKhoi("doan_van") };
    expect(kiemJsonKeoTha(moCoi).loi.join(" ")).toMatch(/mồ côi/);
    const thieu = { ...docMau(), root: { ...docMau().root, data: { ...docMau().root.data, childrenIds: ["h", "khong_co"] } } };
    expect(kiemJsonKeoTha(thieu).loi.join(" ")).toMatch(/không tồn tại/);
    const anh = chenKhoi(docMau(), taoKhoi("anh"), { chaId: GOC, cot: 0 }).doc;
    expect(kiemJsonKeoTha(anh).loi.join(" ")).toMatch(/Ảnh chưa có URL/);
    expect(kiemJsonKeoTha(capNhatKhoi(docMau(), "nut", { props: { url: "" } })).loi.join(" ")).toMatch(/chưa có link/);
    const bien = capNhatKhoi(docMau(), "h", { props: { text: "Chào {{ma_don}}" } });
    expect(kiemJsonKeoTha(bien).loi.join(" ")).toMatch(/ma_don/);
    expect(kiemJsonKeoTha(capNhatKhoi(docMau(), "h", { props: { text: "Chào {{ma_don|bạn}} và {{ho_ten}}" } })).ok).toBe(true);
  });
});

describe("biến, văn bản thuần, CTA", () => {
  it("docBienTrongJson gom biến không trùng từ tiêu đề/đoạn/nút", () => {
    let d = capNhatKhoi(docMau(), "h", { props: { text: "Chào {{ho_ten|anh/chị}}" } });
    d = capNhatKhoi(d, "p", { props: { text: "{{ho_ten}} ở {{ten_thuong_hieu}} mã {{ma_don|x}}" } });
    const b = docBienTrongJson(d);
    expect(b.map((x) => x.ma)).toEqual(["ho_ten", "ten_thuong_hieu", "ma_don"]);
    expect(b[0]).toEqual({ ma: "ho_ten", duPhong: "anh/chị", hopLe: true });
    expect(b[2].hopLe).toBe(false);
    expect(docBienTrongJson(null)).toEqual([]);
  });
  it("keoThaSangVanBan theo DFS, bỏ markdown, giữ biến; coCtaKeoTha", () => {
    const d = capNhatKhoi(docMau(), "p", { props: { text: "Đọc **kỹ** [bài](https://taki.vn/b) {{ho_ten|anh/chị}}" } });
    const t = keoThaSangVanBan(d);
    expect(t.split("\n\n")).toEqual(["Tiêu đề email", "[Xem chi tiết] https://taki.vn", "Đọc kỹ bài (https://taki.vn/b) {{ho_ten|anh/chị}}"]);
    expect(coCtaKeoTha(d)).toBe(true);
    expect(coCtaKeoTha(capNhatKhoi(xoaKhoi(docMau(), "cot"), "p", { props: { text: "không có link nào" } }))).toBe(false);
    expect(keoThaSangVanBan(null)).toBe("");
  });
});

describe("10 mẫu kéo thả hệ thống", () => {
  it("mã duy nhất, hợp lệ theo kiemJsonKeoTha, có nút CTA, ≥4 mẫu có cột, không gạch ngang dài, không hứa thu nhập", () => {
    expect(MAU_EMAIL_KEO_THA.length).toBe(10);
    expect(new Set(MAU_EMAIL_KEO_THA.map((m) => m.ma)).size).toBe(10);
    let coCot = 0;
    for (const m of MAU_EMAIL_KEO_THA) {
      const kq = kiemJsonKeoTha(m.noiDungKeoTha);
      expect(kq.loi, m.ma).toEqual([]);
      expect(coCtaKeoTha(m.noiDungKeoTha), m.ma).toBe(true);
      if (Object.values(m.noiDungKeoTha).some((k) => k.type === "ColumnsContainer")) coCot++;
      const chu = `${m.tieuDe} ${m.preheader} ${keoThaSangVanBan(m.noiDungKeoTha)}`;
      expect(chu, m.ma).not.toMatch(/—|–/);
      expect(chu, m.ma).not.toMatch(/cam kết (thu nhập|lợi nhuận)|x\d+ doanh thu|đảm bảo (lãi|thu)/i);
      expect(chu, m.ma).toMatch(/anh\/chị/);
      expect(m.ma.startsWith("kt-")).toBe(true);
    }
    expect(coCot).toBeGreaterThanOrEqual(4);
  });
  it("id khối tất định theo mã mẫu (seed chạy lại không đổi)", () => {
    const m = MAU_EMAIL_KEO_THA[0];
    for (const id of Object.keys(m.noiDungKeoTha)) expect(id === GOC || id.startsWith("kt_chao_mung_")).toBe(true);
  });
  it("render ra HTML bảng, có meta charset, preheader, footer hủy nhận idempotent, biến thay được khi xem thử", async () => {
    const m = MAU_EMAIL_KEO_THA[0];
    const html = await renderEmailKeoTha(m.noiDungKeoTha, { tenGui: "TAKI Academy", preheader: m.preheader });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain('<meta charset="utf-8"/>');
    expect(html).toContain("<table");
    expect(html).toContain(DAU_FOOTER);
    expect(html).toContain("{{link_huy_nhan}}");
    expect(html).toContain("{{ho_ten|anh/chị}}");
    expect(html).toContain("Ba thứ anh/chị sẽ nhận");
    expect((html.match(/<td/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/display:\s*flex/i);
    const xem = await renderEmailKeoTha(m.noiDungKeoTha, { tenGui: "TAKI Academy", linkHuyNhan: "#huy", bien: { ho_ten: "Kiểm" } });
    expect(xem).toContain("Chào Kiểm");
    expect(xem).not.toContain("{{ho_ten");
    expect(xem.split(DAU_FOOTER).length).toBe(2);
    await expect(renderEmailKeoTha(taoTaiLieuTrong(), { tenGui: "x" })).rejects.toThrow(/trống/);
  });
});

describe("timeline chuỗi: sapXepLaiViTri + doiChoNgay", () => {
  const ds = [{ id: "a", vi_tri: 0 }, { id: "b", vi_tri: 1 }, { id: "c", vi_tri: 2 }, { id: "d", vi_tri: 3 }];
  it("kéo xuống, kéo lên, trả vi_tri liên tục 0..n-1", () => {
    expect(sapXepLaiViTri(ds, "a", "c").map((m) => m.id)).toEqual(["b", "c", "a", "d"]);
    expect(sapXepLaiViTri(ds, "d", "b").map((m) => m.id)).toEqual(["a", "d", "b", "c"]);
    const kq = sapXepLaiViTri(ds, "d", "a");
    expect(kq.map((m) => m.vi_tri)).toEqual([0, 1, 2, 3]);
    expect(kq[0].id).toBe("d");
  });
  it("id lạ hoặc kéo lên chính nó → thứ tự cũ nhưng đã chuẩn hoá liên tục (kể cả vi_tri thưa)", () => {
    const thua = [{ id: "x", vi_tri: 5 }, { id: "y", vi_tri: 2 }, { id: "z", vi_tri: 9 }];
    expect(sapXepLaiViTri(thua, "x", "x")).toEqual([{ id: "y", vi_tri: 0 }, { id: "x", vi_tri: 1 }, { id: "z", vi_tri: 2 }]);
    expect(sapXepLaiViTri(ds, "a", "khong")).toEqual(ds);
  });
  it("doiChoNgay kẹp ≥0, làm tròn 0,5, tổng ngày tích luỹ không giảm", () => {
    const cn = [{ id: "a", vi_tri: 0, cho_ngay: 0 }, { id: "b", vi_tri: 1, cho_ngay: 1 }, { id: "c", vi_tri: 2, cho_ngay: 2 }];
    const kq = doiChoNgay(cn, "b", -3);
    expect(kq.find((m) => m.id === "b")?.cho_ngay).toBe(0);
    expect(doiChoNgay(cn, "c", 1.26).find((m) => m.id === "c")?.cho_ngay).toBe(1.5);
    expect(doiChoNgay(cn, "c", Number.NaN).find((m) => m.id === "c")?.cho_ngay).toBe(0);
    expect(doiChoNgay(cn, "c", 999).find((m) => m.id === "c")?.cho_ngay).toBe(365);
    const tl = tinhNgayTichLuy(doiChoNgay(cn, "b", 3));
    expect(tl).toEqual([{ id: "a", ngay: 0 }, { id: "b", ngay: 3 }, { id: "c", ngay: 5 }]);
    for (let i = 1; i < tl.length; i++) expect(tl[i].ngay).toBeGreaterThanOrEqual(tl[i - 1].ngay);
  });
});
