// Đợt H (nhánh 5, BIG UPDATE 09/2026) — EMAIL KÉO THẢ THẬT. Phần THUẦN cho trình soạn kéo thả:
// tài liệu JSON theo schema của @usewaypoint/email-builder (MIT: zod + renderToStaticMarkup ra HTML bảng),
// bảng khối tiếng Việt, thao tác cây BẤT BIẾN (chèn / di chuyển / xoá / nhân bản / cập nhật), kiểm JSON
// (schema zod của thư viện + không link javascript: + biến hợp lệ + không khối mồ côi), đọc biến, đổi ra văn bản
// thuần (chấm điểm F-110, thẻ xem nhanh), và logic timeline chuỗi email: sapXepLaiViTri + doiChoNgay.
// Gói npm chỉ có Reader/render — trình soạn (components/soan-email-keo-tha-editor.tsx) tự dựng bằng dnd-kit.
import { ReaderDocumentSchema } from "@usewaypoint/email-builder";
import { laBienHopLe, laUrlNguyHiem } from "./email-khoi.ts";

export type KhoiKeoTha = {
  type: string;
  data: { style?: Record<string, unknown> | null; props?: Record<string, unknown> | null } & Record<string, unknown>;
};
/** Tài liệu kéo thả: bảng phẳng id → khối, khối gốc luôn là `root` (EmailLayout). */
export type TaiLieuKeoTha = Record<string, KhoiKeoTha>;
export const GOC = "root";

export type Dem = { top: number; bottom: number; left: number; right: number };
export type DichKeoTha = { chaId: string; cot: number; viTri?: number };

export type MaKhoiKeoTha = "tieu_de" | "doan_van" | "nut" | "anh" | "ngan_cach" | "khoang_cach" | "cot_2" | "cot_3" | "khung" | "html" | "chan_trang";
export type MucBangKhoi = { ma: MaKhoiKeoTha; ten: string; moTa: string; nhom: "noi_dung" | "bo_cuc" };

/** Bảng khối bên trái của trình soạn (tiếng Việt). */
export const BANG_KHOI: MucBangKhoi[] = [
  { ma: "tieu_de", ten: "Tiêu đề", moTa: "Dòng tiêu đề lớn, vừa hoặc nhỏ", nhom: "noi_dung" },
  { ma: "doan_van", ten: "Đoạn văn", moTa: "Chữ thường, hỗ trợ **đậm** và [link](url)", nhom: "noi_dung" },
  { ma: "nut", ten: "Nút", moTa: "Nút bấm có link (CTA)", nhom: "noi_dung" },
  { ma: "anh", ten: "Ảnh", moTa: "Ảnh từ URL, có thể gắn link", nhom: "noi_dung" },
  { ma: "html", ten: "HTML", moTa: "Mã HTML thô (không script)", nhom: "noi_dung" },
  { ma: "chan_trang", ten: "Chân trang", moTa: "Chữ nhỏ cuối thư (footer hủy nhận hệ thống vẫn tự thêm)", nhom: "noi_dung" },
  { ma: "ngan_cach", ten: "Ngăn cách", moTa: "Đường kẻ ngang", nhom: "bo_cuc" },
  { ma: "khoang_cach", ten: "Khoảng cách", moTa: "Khoảng trống theo pixel", nhom: "bo_cuc" },
  { ma: "cot_2", ten: "Cột 2", moTa: "Hai cột, kéo khối vào từng cột", nhom: "bo_cuc" },
  { ma: "cot_3", ten: "Cột 3", moTa: "Ba cột, kéo khối vào từng cột", nhom: "bo_cuc" },
  { ma: "khung", ten: "Khung nền", moTa: "Khối có nền và viền riêng, chứa khối con", nhom: "bo_cuc" },
];

export const FONT_KEO_THA: { ma: string; ten: string }[] = [
  { ma: "MODERN_SANS", ten: "Sans hiện đại (Helvetica, Arial)" },
  { ma: "BOOK_SANS", ten: "Sans dễ đọc (Optima, Candara)" },
  { ma: "ORGANIC_SANS", ten: "Sans mềm (Segoe UI, Trebuchet)" },
  { ma: "GEOMETRIC_SANS", ten: "Sans hình học (Avenir, Century Gothic)" },
  { ma: "HEAVY_SANS", ten: "Sans đậm (Bahnschrift, Impact)" },
  { ma: "ROUNDED_SANS", ten: "Sans bo tròn" },
  { ma: "MODERN_SERIF", ten: "Serif hiện đại (Georgia)" },
  { ma: "BOOK_SERIF", ten: "Serif cổ điển (Times)" },
  { ma: "MONOSPACE", ten: "Đơn cách (Courier)" },
];

export const DEM_MAC_DINH: Dem = { top: 16, bottom: 16, left: 24, right: 24 };
const MAU_CAM = "#f97316", MAU_NAVY = "#0f2a4a", MAU_CHU = "#1f2937", MAU_MO = "#6b7280", MAU_VIEN = "#e5e7eb";

let demId = 0;
/** Id khối mới: ngắn, không trùng trong một phiên (thêm tiền tố tuỳ chọn để mẫu seed có id tất định). */
export function sinhId(tienTo = "k"): string {
  demId = (demId + 1) % 1_000_000;
  return `${tienTo}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 7)}${demId.toString(36)}`;
}

/** Tài liệu trống (chỉ khối gốc) theo nhận diện TAKI. */
export function taoTaiLieuTrong(): TaiLieuKeoTha {
  return {
    [GOC]: { type: "EmailLayout", data: { backdropColor: "#f3f4f6", canvasColor: "#ffffff", textColor: MAU_CHU, fontFamily: "MODERN_SANS", borderColor: MAU_VIEN, borderRadius: 12, childrenIds: [] } },
  };
}

/** Khối mặc định theo mã trong bảng khối. */
export function taoKhoi(ma: MaKhoiKeoTha): KhoiKeoTha {
  const dem = { ...DEM_MAC_DINH };
  switch (ma) {
    case "tieu_de": return { type: "Heading", data: { props: { text: "Tiêu đề email", level: "h2" }, style: { color: MAU_NAVY, textAlign: "left", fontWeight: "bold", padding: dem } } };
    case "doan_van": return { type: "Text", data: { props: { text: "Viết nội dung ở đây. Dùng **đậm** hoặc [link](https://taki.vn) nếu cần.", markdown: true }, style: { color: MAU_CHU, fontSize: 15, fontWeight: "normal", textAlign: "left", padding: dem } } };
    case "nut": return { type: "Button", data: { props: { text: "Xem chi tiết", url: "https://taki.vn", buttonBackgroundColor: MAU_CAM, buttonTextColor: "#ffffff", buttonStyle: "rounded", size: "medium", fullWidth: false }, style: { textAlign: "left", fontWeight: "bold", padding: dem } } };
    case "anh": return { type: "Image", data: { props: { url: "", alt: "Ảnh minh hoạ", linkHref: null, contentAlignment: "middle" }, style: { textAlign: "center", padding: dem } } };
    case "html": return { type: "Html", data: { props: { contents: "<p style=\"margin:0\">Mã HTML thô (không script, không thuộc tính on*).</p>" }, style: { color: MAU_CHU, fontSize: 15, textAlign: "left", padding: dem } } };
    case "chan_trang": return { type: "Text", data: { props: { text: "Nguyễn Tất Kiểm · Founder TAKI Academy · Tỉnh trước. Tiền sau.", markdown: true }, style: { color: MAU_MO, fontSize: 12, fontWeight: "normal", textAlign: "center", padding: dem } } };
    case "ngan_cach": return { type: "Divider", data: { props: { lineColor: MAU_VIEN, lineHeight: 1 }, style: { padding: { top: 8, bottom: 8, left: 24, right: 24 } } } };
    case "khoang_cach": return { type: "Spacer", data: { props: { height: 24 } } };
    case "cot_2": case "cot_3": return { type: "ColumnsContainer", data: { props: { columnsCount: ma === "cot_2" ? 2 : 3, columnsGap: 16, contentAlignment: "top", columns: [{ childrenIds: [] }, { childrenIds: [] }, { childrenIds: [] }] }, style: { padding: { top: 8, bottom: 8, left: 24, right: 24 } } } };
    case "khung": return { type: "Container", data: { props: { childrenIds: [] }, style: { backgroundColor: "#f8fafc", borderColor: MAU_VIEN, borderRadius: 12, padding: dem } } };
  }
}

/** Tên tiếng Việt của một khối (theo type, có phân biệt chân trang). */
export function tenKhoi(k: KhoiKeoTha | undefined): string {
  if (!k) return "Khối";
  switch (k.type) {
    case "EmailLayout": return "Email";
    case "Heading": return "Tiêu đề";
    case "Text": return Number(k.data.style?.fontSize ?? 15) <= 12 ? "Chân trang" : "Đoạn văn";
    case "Button": return "Nút";
    case "Image": return "Ảnh";
    case "Html": return "HTML";
    case "Divider": return "Ngăn cách";
    case "Spacer": return "Khoảng cách";
    case "ColumnsContainer": return `Cột ${k.data.props?.columnsCount ?? 2}`;
    case "Container": return "Khung nền";
    case "Avatar": return "Avatar";
    default: return k.type;
  }
}

// ---------- Cây khối (bất biến) ----------
const mang = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);

/** Các ngăn chứa con của một khối: root/Container có 1 ngăn; ColumnsContainer có columnsCount ngăn; khác: rỗng. */
export function cacNganCon(k: KhoiKeoTha | undefined): string[][] {
  if (!k) return [];
  if (k.type === "EmailLayout") return [mang(k.data.childrenIds)];
  if (k.type === "Container") return [mang(k.data.props?.childrenIds)];
  if (k.type === "ColumnsContainer") {
    const soCot = Number(k.data.props?.columnsCount ?? 2) === 3 ? 3 : 2;
    const cot = Array.isArray(k.data.props?.columns) ? (k.data.props!.columns as { childrenIds?: unknown }[]) : [];
    return Array.from({ length: soCot }, (_, i) => mang(cot[i]?.childrenIds));
  }
  return [];
}
export const laKhoiChua = (k: KhoiKeoTha | undefined): boolean => cacNganCon(k).length > 0;

function datNgan(k: KhoiKeoTha, cot: number, ids: string[]): KhoiKeoTha {
  if (k.type === "EmailLayout") return { ...k, data: { ...k.data, childrenIds: ids } };
  if (k.type === "Container") return { ...k, data: { ...k.data, props: { ...(k.data.props ?? {}), childrenIds: ids } } };
  if (k.type === "ColumnsContainer") {
    const cu = Array.isArray(k.data.props?.columns) ? (k.data.props!.columns as { childrenIds: string[] }[]) : [];
    const columns = [0, 1, 2].map((i) => ({ childrenIds: i === cot ? ids : mang(cu[i]?.childrenIds) }));
    return { ...k, data: { ...k.data, props: { ...(k.data.props ?? {}), columns } } };
  }
  return k;
}

/** Tìm cha + ngăn + vị trí của một khối; null nếu là root hoặc mồ côi. */
export function timCha(doc: TaiLieuKeoTha, id: string): { chaId: string; cot: number; viTri: number } | null {
  for (const [chaId, k] of Object.entries(doc)) {
    const ngan = cacNganCon(k);
    for (let cot = 0; cot < ngan.length; cot++) {
      const viTri = ngan[cot].indexOf(id);
      if (viTri >= 0) return { chaId, cot, viTri };
    }
  }
  return null;
}

/** Mọi id con cháu (DFS) của một khối. */
export function conChau(doc: TaiLieuKeoTha, id: string): string[] {
  const ra: string[] = [];
  const di = (x: string) => { for (const ngan of cacNganCon(doc[x])) for (const c of ngan) { ra.push(c); di(c); } };
  di(id);
  return ra;
}

/** Thứ tự DFS mọi khối hiển thị (không gồm root). */
export const thuTuKhoi = (doc: TaiLieuKeoTha): string[] => conChau(doc, GOC);

/** Chèn khối (kèm con cháu nếu truyền `kem`) vào ngăn đích; viTri bỏ trống = cuối ngăn. */
export function chenKhoi(doc: TaiLieuKeoTha, khoi: KhoiKeoTha, dich: DichKeoTha, id = sinhId(), kem: TaiLieuKeoTha = {}): { doc: TaiLieuKeoTha; id: string } {
  const cha = doc[dich.chaId];
  const ngan = cacNganCon(cha);
  if (!cha || !ngan[dich.cot]) return { doc, id };
  const ids = [...ngan[dich.cot]];
  const vt = dich.viTri === undefined ? ids.length : Math.max(0, Math.min(ids.length, dich.viTri));
  ids.splice(vt, 0, id);
  return { doc: { ...doc, ...kem, [id]: khoi, [dich.chaId]: datNgan(cha, dich.cot, ids) }, id };
}

/** Gỡ khối khỏi cha (không xoá dữ liệu khối). */
function goKhoiCha(doc: TaiLieuKeoTha, id: string): TaiLieuKeoTha {
  const cha = timCha(doc, id);
  if (!cha) return doc;
  const ids = cacNganCon(doc[cha.chaId])[cha.cot].filter((x) => x !== id);
  return { ...doc, [cha.chaId]: datNgan(doc[cha.chaId], cha.cot, ids) };
}

/** Di chuyển khối sang ngăn/vị trí khác (cả trong cùng ngăn). Không cho kéo vào chính con cháu của nó. */
export function diChuyenKhoi(doc: TaiLieuKeoTha, id: string, dich: DichKeoTha): TaiLieuKeoTha {
  if (id === GOC || !doc[id] || !doc[dich.chaId]) return doc;
  if (dich.chaId === id || conChau(doc, id).includes(dich.chaId)) return doc;
  const cu = timCha(doc, id);
  let viTri = dich.viTri;
  // cùng ngăn và kéo xuống dưới: sau khi gỡ, chỉ số đích lùi 1
  if (cu && viTri !== undefined && cu.chaId === dich.chaId && cu.cot === dich.cot && cu.viTri < viTri) viTri -= 1;
  const daGo = goKhoiCha(doc, id);
  return chenKhoi(daGo, doc[id], { ...dich, viTri }, id).doc;
}

/** Xoá khối và toàn bộ con cháu. */
export function xoaKhoi(doc: TaiLieuKeoTha, id: string): TaiLieuKeoTha {
  if (id === GOC || !doc[id]) return doc;
  const bo = new Set([id, ...conChau(doc, id)]);
  const daGo = goKhoiCha(doc, id);
  return Object.fromEntries(Object.entries(daGo).filter(([k]) => !bo.has(k)));
}

/** Nhân bản khối (sâu, id mới) đặt ngay sau bản gốc. */
export function nhanBanKhoi(doc: TaiLieuKeoTha, id: string): { doc: TaiLieuKeoTha; id: string } {
  const cha = timCha(doc, id);
  if (!cha || !doc[id]) return { doc, id };
  const anhXa = new Map<string, string>();
  for (const x of [id, ...conChau(doc, id)]) anhXa.set(x, sinhId());
  const sao = (k: KhoiKeoTha): KhoiKeoTha => {
    const j = JSON.parse(JSON.stringify(k)) as KhoiKeoTha;
    const doiIds = (ids: unknown) => mang(ids).map((c) => anhXa.get(c) ?? c);
    if (j.type === "EmailLayout") j.data.childrenIds = doiIds(j.data.childrenIds);
    if (j.type === "Container" && j.data.props) j.data.props.childrenIds = doiIds(j.data.props.childrenIds);
    if (j.type === "ColumnsContainer" && Array.isArray(j.data.props?.columns)) j.data.props!.columns = (j.data.props!.columns as { childrenIds?: unknown }[]).map((c) => ({ childrenIds: doiIds(c?.childrenIds) }));
    return j;
  };
  const kem: TaiLieuKeoTha = {};
  for (const x of conChau(doc, id)) kem[anhXa.get(x)!] = sao(doc[x]);
  return chenKhoi(doc, sao(doc[id]), { chaId: cha.chaId, cot: cha.cot, viTri: cha.viTri + 1 }, anhXa.get(id)!, kem);
}

/** Cập nhật props/style (gộp nông) hoặc thuộc tính gốc (root). */
export function capNhatKhoi(doc: TaiLieuKeoTha, id: string, va: { props?: Record<string, unknown>; style?: Record<string, unknown>; goc?: Record<string, unknown> }): TaiLieuKeoTha {
  const k = doc[id];
  if (!k) return doc;
  const data = { ...k.data, ...(va.goc ?? {}) };
  if (va.props) data.props = { ...(k.data.props ?? {}), ...va.props };
  if (va.style) data.style = { ...(k.data.style ?? {}), ...va.style };
  return { ...doc, [id]: { ...k, data } };
}

/** Đổi số cột (2 ↔ 3): xuống 2 cột thì khối của cột 3 dồn về cuối cột 2, không mất khối. */
export function doiSoCot(doc: TaiLieuKeoTha, id: string, soCot: 2 | 3): TaiLieuKeoTha {
  const k = doc[id];
  if (!k || k.type !== "ColumnsContainer") return doc;
  const cot = Array.isArray(k.data.props?.columns) ? (k.data.props!.columns as { childrenIds?: unknown }[]) : [];
  const c = [0, 1, 2].map((i) => mang(cot[i]?.childrenIds));
  const columns = soCot === 2 ? [{ childrenIds: c[0] }, { childrenIds: [...c[1], ...c[2]] }, { childrenIds: [] }] : c.map((x) => ({ childrenIds: x }));
  return { ...doc, [id]: { ...k, data: { ...k.data, props: { ...(k.data.props ?? {}), columnsCount: soCot, columns } } } };
}

// ---------- Kiểm JSON ----------
const RE_BIEN = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;
const RE_LINK_MD = /\]\(\s*([^)\s]+)/g;

function chuoiCua(k: KhoiKeoTha): { chu: string[]; url: string[] } {
  const p = k.data.props ?? {};
  const chu: string[] = [], url: string[] = [];
  for (const t of ["text", "alt", "contents"]) if (typeof p[t] === "string") chu.push(p[t] as string);
  for (const u of ["url", "linkHref", "imageUrl"]) if (typeof p[u] === "string" && p[u]) url.push(p[u] as string);
  if (k.type === "Text" && typeof p.text === "string") for (const m of (p.text as string).matchAll(RE_LINK_MD)) url.push(m[1]);
  if (k.type === "Html" && typeof p.contents === "string") for (const m of (p.contents as string).matchAll(/href\s*=\s*["']?([^"'\s>]+)/gi)) url.push(m[1]);
  return { chu, url };
}

/**
 * Kiểm tài liệu kéo thả trước khi lưu/render: đúng schema zod của thư viện, có root EmailLayout, mọi id con tồn tại,
 * không khối mồ côi, không link javascript:/data:, HTML thô không script, ảnh phải có URL, biến lạ phải có dự phòng,
 * và không rỗng (ít nhất một khối có nội dung).
 */
export function kiemJsonKeoTha(json: unknown): { ok: boolean; loi: string[] } {
  const loi: string[] = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, loi: ["Nội dung kéo thả không hợp lệ (không phải bảng khối)."] };
  const doc = json as TaiLieuKeoTha;
  if (!doc[GOC] || doc[GOC].type !== "EmailLayout") return { ok: false, loi: ["Thiếu khối gốc «root» kiểu EmailLayout."] };
  const zod = ReaderDocumentSchema.safeParse(doc);
  if (!zod.success) {
    for (const v of zod.error.issues.slice(0, 5)) loi.push(`Sai cấu trúc ở ${v.path.join(".") || "gốc"}: ${/Color|color/.test(String(v.path.at(-1))) && /^Invalid/.test(v.message) ? "màu phải dạng #rrggbb (6 ký tự hex)" : v.message}`);
    return { ok: false, loi };
  }
  const thay = new Set<string>();
  const di = (id: string, sau: number) => {
    if (sau > 6) { loi.push("Khối lồng quá sâu (tối đa 6 cấp)."); return; }
    for (const ngan of cacNganCon(doc[id])) for (const c of ngan) {
      if (!doc[c]) { loi.push(`Khối «${c}» được tham chiếu nhưng không tồn tại.`); continue; }
      if (thay.has(c)) { loi.push(`Khối «${c}» xuất hiện ở hai chỗ.`); continue; }
      thay.add(c); di(c, sau + 1);
    }
  };
  di(GOC, 0);
  const moCoi = Object.keys(doc).filter((k) => k !== GOC && !thay.has(k));
  if (moCoi.length) loi.push(`Có ${moCoi.length} khối mồ côi không nằm trong email (${moCoi.slice(0, 3).join(", ")}).`);
  let coNoiDung = false;
  for (const id of thay) {
    const k = doc[id];
    const { chu, url } = chuoiCua(k);
    if (["Heading", "Text", "Button", "Html"].includes(k.type) && chu.some((c) => c.trim())) coNoiDung = true;
    if (k.type === "Image") {
      if (!String(k.data.props?.url ?? "").trim()) loi.push("Có khối Ảnh chưa có URL ảnh.");
      else coNoiDung = true;
    }
    for (const u of url) if (laUrlNguyHiem(u)) loi.push(`Link không an toàn: ${u.slice(0, 60)}`);
    if (k.type === "Button" && !String(k.data.props?.url ?? "").trim()) loi.push(`Nút «${k.data.props?.text ?? ""}» chưa có link.`);
    if (k.type === "Html" && /<script|<iframe|on[a-z]+\s*=/i.test(String(k.data.props?.contents ?? ""))) loi.push("Khối HTML thô chứa script/iframe hoặc thuộc tính on*: email không được phép.");
    for (const c of chu) for (const m of c.matchAll(RE_BIEN)) {
      const ma = m[1], duPhong = (m[2] ?? "").trim();
      if (!laBienHopLe(ma) && !duPhong) loi.push(`Biến {{${ma}}} không có trong danh sách biến và không có giá trị dự phòng — thư gửi ra sẽ bị trống chỗ này.`);
    }
  }
  if (!coNoiDung) loi.unshift("Nội dung trống — kéo ít nhất một khối Tiêu đề, Đoạn văn, Nút hoặc Ảnh vào email.");
  return { ok: loi.length === 0, loi: [...new Set(loi)] };
}

/** Biến {{ten|dự phòng}} dùng trong tài liệu (không trùng), kèm cờ có dự phòng và hợp lệ. */
export function docBienTrongJson(json: TaiLieuKeoTha | null | undefined): { ma: string; duPhong: string; hopLe: boolean }[] {
  if (!json) return [];
  const ra = new Map<string, { ma: string; duPhong: string; hopLe: boolean }>();
  for (const k of Object.values(json)) {
    if (!k || typeof k !== "object") continue;
    for (const c of chuoiCua(k).chu) for (const m of c.matchAll(RE_BIEN)) {
      if (!ra.has(m[1])) ra.set(m[1], { ma: m[1], duPhong: (m[2] ?? "").trim(), hopLe: laBienHopLe(m[1]) });
    }
  }
  return [...ra.values()];
}

/** Văn bản thuần theo thứ tự DFS (thẻ xem nhanh, chấm điểm F-110, kiểm CTA bán). Biến giữ nguyên cú pháp. */
export function keoThaSangVanBan(json: TaiLieuKeoTha | null | undefined): string {
  if (!json || !json[GOC]) return "";
  const ra: string[] = [];
  const boMd = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/^#+\s*/gm, "");
  for (const id of thuTuKhoi(json)) {
    const k = json[id]; const p = k?.data.props ?? {};
    switch (k?.type) {
      case "Heading": case "Text": if (typeof p.text === "string" && p.text.trim()) ra.push(boMd(p.text.trim())); break;
      case "Button": ra.push(`[${p.text ?? "Nút"}] ${p.url ?? ""}`.trim()); break;
      case "Image": ra.push(`[ảnh: ${p.alt ?? p.url ?? ""}]`); break;
      case "Html": ra.push(String(p.contents ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); break;
      case "Divider": ra.push("---"); break;
    }
  }
  return ra.filter(Boolean).join("\n\n");
}

/** Email kéo thả có CTA: ít nhất một Nút có link http(s), hoặc link http trong đoạn văn. */
export function coCtaKeoTha(json: TaiLieuKeoTha | null | undefined): boolean {
  if (!json) return false;
  return thuTuKhoi(json).some((id) => {
    const k = json[id]; const p = k?.data.props ?? {};
    if (k?.type === "Button") return /^https?:\/\//i.test(String(p.url ?? ""));
    if (k?.type === "Text") return /\]\(\s*https?:\/\//i.test(String(p.text ?? ""));
    return false;
  });
}

/** Đọc tài liệu từ chuỗi form (JSON hỏng → null). */
export function docKeoThaTuChuoi(s: string | null | undefined): TaiLieuKeoTha | null {
  if (!s || !s.trim()) return null;
  try {
    const j = JSON.parse(s);
    return j && typeof j === "object" && !Array.isArray(j) && j[GOC] ? (j as TaiLieuKeoTha) : null;
  } catch { return null; }
}

// ---------- Timeline chuỗi email: thứ tự + ngày chờ ----------
export type MucViTri = { id: string; vi_tri: number };
export type MucChoNgay = MucViTri & { cho_ngay: number };

/**
 * Kéo email `tuId` tới chỗ của `denId` (đặt vào vị trí của denId, các email khác dồn theo).
 * Trả về mảng vi_tri MỚI LIÊN TỤC 0..n-1 theo thứ tự sau khi kéo. Không tìm thấy id → trả nguyên thứ tự cũ (đã chuẩn hoá).
 */
export function sapXepLaiViTri(danhSach: MucViTri[], tuId: string, denId: string): MucViTri[] {
  const ds = [...danhSach].sort((a, b) => a.vi_tri - b.vi_tri).map((m) => m.id);
  const tu = ds.indexOf(tuId), den = ds.indexOf(denId);
  if (tu >= 0 && den >= 0 && tu !== den) {
    ds.splice(tu, 1);
    ds.splice(den, 0, tuId);
  }
  return ds.map((id, vi_tri) => ({ id, vi_tri }));
}

/** Ngày tích luỹ (kể từ lúc ghi danh) của từng email theo vi_tri: cộng dồn cho_ngay. */
export function tinhNgayTichLuy(danhSach: MucChoNgay[]): { id: string; ngay: number }[] {
  let tong = 0;
  return [...danhSach].sort((a, b) => a.vi_tri - b.vi_tri).map((m) => { tong += Math.max(0, Number(m.cho_ngay) || 0); return { id: m.id, ngay: Math.round(tong * 100) / 100 }; });
}

/**
 * Đổi cho_ngay (số ngày chờ kể từ email trước) của một email. cho_ngay là hiệu số nên luôn được kẹp ≥ 0
 * (làm tròn 0,5 ngày, tối đa 365) → tổng ngày tích luỹ theo thứ tự luôn TĂNG DẦN (không giảm). Trả danh sách mới.
 */
export function doiChoNgay(danhSach: MucChoNgay[], id: string, choNgayMoi: number): MucChoNgay[] {
  const n = Number(choNgayMoi);
  const chuan = Number.isFinite(n) ? Math.min(365, Math.max(0, Math.round(n * 2) / 2)) : 0;
  return [...danhSach].sort((a, b) => a.vi_tri - b.vi_tri).map((m) => (m.id === id ? { ...m, cho_ngay: chuan } : { ...m, cho_ngay: Math.max(0, Number(m.cho_ngay) || 0) }));
}
