// TRÌNH SOẠN EMAIL KÉO THẢ — port từ auto-funnel components/soan-email-keo-tha(-editor).tsx.
// Tự dựng (gói npm @usewaypoint/email-builder chỉ có Reader/render, không có editor):
// bảng khối bên trái (kéo vào canvas hoặc bấm đúp để thêm cuối), canvas giữa là cây khối với ngăn thả LỒNG NHAU
// (root, Khung nền, từng cột của Cột 2/3) bằng @dnd-kit (MIT), panel phải sửa thuộc tính khối đang chọn.
// Mọi thao tác cây đi qua hàm THUẦN ở @dotaka/email/web (email-keo-tha, có test); component chỉ giữ state + vẽ.
// Bản gốc có Xem trước / Gửi thử bằng server action — ở đây trang cha tự lo. Nạp bằng React.lazy (EmailComposer).
import "./email-editor.css";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BIEN_EMAIL } from "@dotaka/email/web";
import {
  BANG_KHOI, FONT_KEO_THA, GOC, MAU_EMAIL_KEO_THA, NHOM_MAU_KHOI, kiemJsonKeoTha, taoTaiLieuTrong, cacNganCon, capNhatKhoi, chenKhoi, conChau, diChuyenKhoi, doiSoCot, nhanBanKhoi, taoKhoi, tenKhoi, timCha, xoaKhoi,
  type Dem, type KhoiKeoTha, type MaKhoiKeoTha, type TaiLieuKeoTha,
} from "@dotaka/email/web";

export type SoanKeoThaProps = {
  taiLieu: TaiLieuKeoTha;
  onDoi: (doc: TaiLieuKeoTha) => void;
  chiDoc?: boolean;
  /** 600 = máy tính, 375 = điện thoại. */
  rong: 600 | 375;
};

const FONT_CSS: Record<string, string> = {
  MODERN_SANS: '"Helvetica Neue", "Arial Nova", "Nimbus Sans", Arial, sans-serif',
  BOOK_SANS: 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif',
  ORGANIC_SANS: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
  GEOMETRIC_SANS: 'Avenir, "Avenir Next LT Pro", Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif',
  HEAVY_SANS: 'Bahnschrift, "DIN Alternate", "Franklin Gothic Medium", "Nimbus Sans Narrow", sans-serif-condensed, sans-serif',
  ROUNDED_SANS: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", Calibri, source-sans-pro, sans-serif',
  MODERN_SERIF: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
  BOOK_SERIF: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif',
  MONOSPACE: '"Nimbus Mono PS", "Courier New", monospace',
};
const KY_HIEU: Record<MaKhoiKeoTha, string> = { tieu_de: "H", doan_van: "¶", nut: "▭", anh: "▣", html: "</>", chan_trang: "≡", ngan_cach: "—", khoang_cach: "↕", cot_2: "▯▯", cot_3: "▯▯▯", khung: "▢" };

const demCua = (k: KhoiKeoTha): Dem => {
  const p = k.data.style?.padding as Partial<Dem> | null | undefined;
  return { top: p?.top ?? 0, bottom: p?.bottom ?? 0, left: p?.left ?? 0, right: p?.right ?? 0 };
};
const demCss = (k: KhoiKeoTha) => { const d = demCua(k); return `${d.top}px ${d.right}px ${d.bottom}px ${d.left}px`; };

/** Markdown nhẹ → React (đậm, link, xuống dòng) — không dùng innerHTML. */
function mdNhe(text: string): ReactNode {
  const dong = text.split(/\n/);
  return dong.map((d, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {d.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((m, j) => {
        if (/^\*\*[^*]+\*\*$/.test(m)) return <b key={j}>{m.slice(2, -2)}</b>;
        const l = m.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (l) return <span key={j} style={{ color: "#1e40af", textDecoration: "underline" }}>{l[1]}</span>;
        return <Fragment key={j}>{m}</Fragment>;
      })}
    </Fragment>
  ));
}

// ---------- Bảng khối (trái) ----------
function MucBang({ ma, ten, moTa, onThem, chiDoc }: { ma: MaKhoiKeoTha; ten: string; moTa: string; onThem: () => void; chiDoc: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `moi:${ma}`, data: { loai: "moi", ma }, disabled: chiDoc });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="keo-tha-muc" style={{ opacity: isDragging ? 0.4 : 1 }}
      role="button" aria-label={`Khối ${ten}`} title="Kéo vào email, hoặc bấm đúp để thêm vào cuối" onDoubleClick={onThem}>
      <span className="icon-khoi" aria-hidden>{KY_HIEU[ma]}</span>
      <span className="min-w-0"><b>{ten}</b><small>{moTa}</small></span>
    </div>
  );
}

// ---------- Ngăn thả + khối trong canvas ----------
type NguCanh = { doc: TaiLieuKeoTha; chonId: string | null; chon: (id: string) => void; chiDoc: boolean; dangKeoId: string | null; xoa: (id: string) => void; nhanBan: (id: string) => void };

function VungChua({ chaId, cot, ids, nc, className, style }: { chaId: string; cot: number; ids: string[]; nc: NguCanh; className?: string; style?: CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id: `vung:${chaId}:${cot}`, data: { loai: "vung", chaId, cot }, disabled: nc.chiDoc });
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={`keo-tha-vung ${ids.length === 0 ? "rong" : ""} ${isOver ? "dang-qua" : ""} ${className ?? ""}`} style={style} data-vung={`${chaId}:${cot}`}>
        {ids.length === 0 ? "Kéo khối vào đây" : ids.map((id) => <KhoiCanvas key={id} id={id} nc={nc} />)}
      </div>
    </SortableContext>
  );
}

function KhoiCanvas({ id, nc }: { id: string; nc: NguCanh }) {
  const k = nc.doc[id];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, data: { loai: "khoi", id }, disabled: nc.chiDoc });
  if (!k) return null;
  const chon = nc.chonId === id;
  const st = k.data.style ?? {};
  const p = k.data.props ?? {};
  let than: ReactNode = null;
  switch (k.type) {
    case "Heading": {
      const size = p.level === "h1" ? 32 : p.level === "h3" ? 20 : 24;
      than = <div style={{ padding: demCss(k), color: (st.color as string) ?? undefined, backgroundColor: (st.backgroundColor as string) ?? undefined, textAlign: (st.textAlign as "left") ?? "left", fontWeight: st.fontWeight === "normal" ? 400 : 700, fontSize: size, lineHeight: 1.25, fontFamily: st.fontFamily ? FONT_CSS[st.fontFamily as string] : undefined }}>{String(p.text ?? "") || <span style={{ opacity: .4 }}>Tiêu đề trống</span>}</div>;
      break;
    }
    case "Text":
      than = <div style={{ padding: demCss(k), color: (st.color as string) ?? undefined, backgroundColor: (st.backgroundColor as string) ?? undefined, textAlign: (st.textAlign as "left") ?? "left", fontWeight: st.fontWeight === "bold" ? 700 : 400, fontSize: Number(st.fontSize ?? 16), lineHeight: 1.5, fontFamily: st.fontFamily ? FONT_CSS[st.fontFamily as string] : undefined, whiteSpace: "pre-wrap" }}>{p.markdown ? mdNhe(String(p.text ?? "")) : String(p.text ?? "")}</div>;
      break;
    case "Button": {
      const bo = p.buttonStyle === "pill" ? 64 : p.buttonStyle === "rectangle" ? 0 : 4;
      const pad = p.size === "x-small" ? "4px 8px" : p.size === "small" ? "8px 12px" : p.size === "large" ? "16px 32px" : "12px 20px";
      than = (
        <div style={{ padding: demCss(k), textAlign: (st.textAlign as "left") ?? "left", backgroundColor: (st.backgroundColor as string) ?? undefined }}>
          <span style={{ display: p.fullWidth ? "block" : "inline-block", backgroundColor: (p.buttonBackgroundColor as string) ?? "#999", color: (p.buttonTextColor as string) ?? "#fff", borderRadius: bo, padding: pad, fontWeight: st.fontWeight === "normal" ? 400 : 700, fontSize: Number(st.fontSize ?? 16), textAlign: "center", fontFamily: st.fontFamily ? FONT_CSS[st.fontFamily as string] : undefined }}>{String(p.text ?? "Nút")}</span>
        </div>
      );
      break;
    }
    case "Image":
      than = (
        <div style={{ padding: demCss(k), textAlign: (st.textAlign as "left") ?? "left", backgroundColor: (st.backgroundColor as string) ?? undefined }}>
          {p.url ? <img src={String(p.url)} alt={String(p.alt ?? "")} style={{ maxWidth: "100%", width: p.width ? Number(p.width) : undefined, height: p.height ? Number(p.height) : undefined, display: "inline-block" }} />
            : <div className="keo-tha-anh-trong">Ảnh: dán URL ở panel bên phải</div>}
        </div>
      );
      break;
    case "Divider":
      than = <div style={{ padding: demCss(k), backgroundColor: (st.backgroundColor as string) ?? undefined }}><div style={{ borderTop: `${Number(p.lineHeight ?? 1)}px solid ${String(p.lineColor ?? "#e5e7eb")}` }} /></div>;
      break;
    case "Spacer":
      than = <div style={{ height: Number(p.height ?? 16), background: "repeating-linear-gradient(135deg, transparent 0 6px, rgba(148,163,184,.18) 6px 7px)" }} />;
      break;
    case "Html":
      than = <div style={{ padding: demCss(k), color: (st.color as string) ?? undefined, fontSize: 12, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#f8fafc" }}>{`</> ${String(p.contents ?? "").slice(0, 300)}`}</div>;
      break;
    case "Container":
      than = (
        <div style={{ padding: demCss(k), backgroundColor: (st.backgroundColor as string) ?? undefined, border: st.borderColor ? `1px solid ${st.borderColor}` : undefined, borderRadius: Number(st.borderRadius ?? 0) }}>
          <VungChua chaId={id} cot={0} ids={cacNganCon(k)[0] ?? []} nc={nc} />
        </div>
      );
      break;
    case "ColumnsContainer": {
      const ngan = cacNganCon(k);
      than = (
        <div style={{ padding: demCss(k), backgroundColor: (st.backgroundColor as string) ?? undefined }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${ngan.length}, minmax(0, 1fr))`, gap: Number(p.columnsGap ?? 16), alignItems: p.contentAlignment === "middle" ? "center" : p.contentAlignment === "bottom" ? "end" : "start" }}>
            {ngan.map((ids, i) => <VungChua key={i} chaId={id} cot={i} ids={ids} nc={nc} />)}
          </div>
        </div>
      );
      break;
    }
    default:
      than = <div style={{ padding: 8, fontSize: 12, color: "#64748b" }}>{k.type}</div>;
  }
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`keo-tha-khoi ${chon ? "chon" : ""} ${isDragging || nc.dangKeoId === id ? "dang-keo" : ""}`}
      data-khoi={id} data-loai={k.type}
      onClick={(e) => { e.stopPropagation(); nc.chon(id); }}>
      <span className="keo-tha-nhan" onClick={(e) => e.stopPropagation()}>
        {!nc.chiDoc && <span ref={setActivatorNodeRef} {...attributes} {...listeners} className="keo-tha-tay" aria-label={`Kéo ${tenKhoi(k)}`} title="Kéo để đổi chỗ">⋮⋮</span>}
        <span>{tenKhoi(k)}</span>
        {!nc.chiDoc && <>
          <button type="button" onClick={() => nc.nhanBan(id)} title="Nhân bản">⧉</button>
          <button type="button" onClick={() => nc.xoa(id)} title="Xoá">✕</button>
        </>}
      </span>
      {than}
    </div>
  );
}

// ---------- Panel thuộc tính (phải) ----------
function ONhapMau({ nhan, gia, onDoi, choPhepTrong }: { nhan: string; gia: unknown; onDoi: (v: string | null) => void; choPhepTrong?: boolean }) {
  const s = typeof gia === "string" ? gia : "";
  return (
    <label>{nhan}
      <span className="keo-tha-mau">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(s) ? s : "#ffffff"} onChange={(e) => onDoi(e.target.value)} aria-label={`${nhan} (bảng màu)`} />
        <input className="o-nhap" value={s} placeholder={choPhepTrong ? "trống = không nền" : "#rrggbb"} onChange={(e) => { const v = e.target.value.trim(); onDoi(v === "" && choPhepTrong ? null : v); }} />
      </span>
    </label>
  );
}
function ONhapSo({ nhan, gia, onDoi, min = 0, max = 1000 }: { nhan: string; gia: unknown; onDoi: (v: number) => void; min?: number; max?: number }) {
  return <label>{nhan}<input type="number" className="o-nhap so" min={min} max={max} value={Number(gia ?? 0)} onChange={(e) => onDoi(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} /></label>;
}
function ChonCan({ gia, onDoi, nhan = "Căn" }: { gia: unknown; onDoi: (v: "left" | "center" | "right") => void; nhan?: string }) {
  return (
    <label>{nhan}
      <span className="keo-tha-can">
        {(["left", "center", "right"] as const).map((c) => <button key={c} type="button" aria-pressed={(gia ?? "left") === c} onClick={() => onDoi(c)}>{c === "left" ? "Trái" : c === "center" ? "Giữa" : "Phải"}</button>)}
      </span>
    </label>
  );
}
function ODem({ k, onDoi }: { k: KhoiKeoTha; onDoi: (d: Dem) => void }) {
  const d = demCua(k);
  return (
    <label>Padding (trên · phải · dưới · trái)
      <span className="keo-tha-hang-4">
        {(["top", "right", "bottom", "left"] as const).map((c) => <input key={c} type="number" className="o-nhap so" min={0} max={120} value={d[c]} aria-label={`Padding ${c}`} onChange={(e) => onDoi({ ...d, [c]: Math.max(0, Number(e.target.value) || 0) })} />)}
      </span>
    </label>
  );
}

function BangThuocTinh({ doc, id, onDoc, chiDoc, chenBien }: { doc: TaiLieuKeoTha; id: string | null; onDoc: (d: TaiLieuKeoTha) => void; chiDoc: boolean; chenBien: (ma: string) => void }) {
  const k = id ? doc[id] : null;
  if (!id || !k) return <div className="keo-tha-thuoc-tinh text-[12px] text-muted">Nhấp một khối trong email để sửa thuộc tính. Bấm vào nền để sửa màu nền, font chung.</div>;
  const props = (v: Record<string, unknown>) => onDoc(capNhatKhoi(doc, id, { props: v }));
  const style = (v: Record<string, unknown>) => onDoc(capNhatKhoi(doc, id, { style: v }));
  const goc = (v: Record<string, unknown>) => onDoc(capNhatKhoi(doc, id, { goc: v }));
  const p = k.data.props ?? {}, st = k.data.style ?? {};
  const laChu = ["Heading", "Text", "Button"].includes(k.type);
  const cha = timCha(doc, id);
  const diChuyen = (buoc: -1 | 1) => { if (cha) onDoc(diChuyenKhoi(doc, id, { chaId: cha.chaId, cot: cha.cot, viTri: cha.viTri + (buoc > 0 ? 2 : -1) })); };
  return (
    <div className="keo-tha-thuoc-tinh" aria-label="Thuộc tính khối">
      <div className="flex items-center gap-1.5">
        <b className="text-[13px] flex-1">{tenKhoi(k)}</b>
        {!chiDoc && id !== GOC && <>
          <button type="button" className="keo-tha-nut" onClick={() => diChuyen(-1)} title="Lên">↑</button>
          <button type="button" className="keo-tha-nut" onClick={() => diChuyen(1)} title="Xuống">↓</button>
          <button type="button" className="keo-tha-nut" onClick={() => onDoc(nhanBanKhoi(doc, id).doc)} title="Nhân bản">⧉</button>
          <button type="button" className="keo-tha-nut nguy" onClick={() => onDoc(xoaKhoi(doc, id))} title="Xoá">✕</button>
        </>}
      </div>
      {chiDoc && <p className="text-[11.5px] text-muted">Chỉ đọc.</p>}
      <fieldset disabled={chiDoc} className="flex flex-col gap-2 min-w-0 border-0 p-0 m-0">
        {k.type === "EmailLayout" && <>
          <ONhapMau nhan="Màu nền ngoài" gia={k.data.backdropColor} onDoi={(v) => goc({ backdropColor: v })} />
          <ONhapMau nhan="Màu nền email" gia={k.data.canvasColor} onDoi={(v) => goc({ canvasColor: v })} />
          <ONhapMau nhan="Màu chữ mặc định" gia={k.data.textColor} onDoi={(v) => goc({ textColor: v })} />
          <ONhapMau nhan="Màu viền" gia={k.data.borderColor} onDoi={(v) => goc({ borderColor: v })} choPhepTrong />
          <ONhapSo nhan="Bo góc (px)" gia={k.data.borderRadius} onDoi={(v) => goc({ borderRadius: v })} max={40} />
          <label>Font
            <select className="o-nhap" value={String(k.data.fontFamily ?? "MODERN_SANS")} onChange={(e) => goc({ fontFamily: e.target.value })}>
              {FONT_KEO_THA.map((f) => <option key={f.ma} value={f.ma}>{f.ten}</option>)}
            </select></label>
        </>}
        {(k.type === "Heading" || k.type === "Text") && (
          <label>Nội dung
            <textarea className="o-nhap" rows={k.type === "Text" ? 6 : 2} value={String(p.text ?? "")} onChange={(e) => props({ text: e.target.value })} />
          </label>
        )}
        {k.type === "Heading" && (
          <label>Cỡ tiêu đề
            <select className="o-nhap" value={String(p.level ?? "h2")} onChange={(e) => props({ level: e.target.value })}>
              <option value="h1">Lớn (H1)</option><option value="h2">Vừa (H2)</option><option value="h3">Nhỏ (H3)</option>
            </select></label>
        )}
        {k.type === "Text" && <>
          <label className="!flex-row items-center gap-2"><input type="checkbox" checked={!!p.markdown} onChange={(e) => props({ markdown: e.target.checked })} /> Hiểu **đậm** và [link](url)</label>
          <ONhapSo nhan="Cỡ chữ (px)" gia={st.fontSize ?? 16} onDoi={(v) => style({ fontSize: v })} min={10} max={48} />
        </>}
        {k.type === "Button" && <>
          <label>Chữ trên nút<input className="o-nhap" value={String(p.text ?? "")} onChange={(e) => props({ text: e.target.value })} /></label>
          <label>Link (https://…)<input className="o-nhap" value={String(p.url ?? "")} placeholder="https://taki.vn/..." onChange={(e) => props({ url: e.target.value })} /></label>
          <div className="keo-tha-hang">
            <ONhapMau nhan="Màu nút" gia={p.buttonBackgroundColor} onDoi={(v) => props({ buttonBackgroundColor: v })} />
            <ONhapMau nhan="Màu chữ nút" gia={p.buttonTextColor} onDoi={(v) => props({ buttonTextColor: v })} />
          </div>
          <div className="keo-tha-hang">
            <label>Kiểu<select className="o-nhap" value={String(p.buttonStyle ?? "rounded")} onChange={(e) => props({ buttonStyle: e.target.value })}>
              <option value="rounded">Bo nhẹ</option><option value="pill">Viên thuốc</option><option value="rectangle">Vuông</option></select></label>
            <label>Cỡ<select className="o-nhap" value={String(p.size ?? "medium")} onChange={(e) => props({ size: e.target.value })}>
              <option value="x-small">Rất nhỏ</option><option value="small">Nhỏ</option><option value="medium">Vừa</option><option value="large">Lớn</option></select></label>
          </div>
          <label className="!flex-row items-center gap-2"><input type="checkbox" checked={!!p.fullWidth} onChange={(e) => props({ fullWidth: e.target.checked })} /> Nút rộng hết cỡ</label>
        </>}
        {k.type === "Image" && <>
          <label>URL ảnh<input className="o-nhap" value={String(p.url ?? "")} placeholder="https://…/anh.png" onChange={(e) => props({ url: e.target.value })} /></label>
          <label>Chữ thay thế (alt)<input className="o-nhap" value={String(p.alt ?? "")} onChange={(e) => props({ alt: e.target.value })} /></label>
          <label>Link khi bấm ảnh<input className="o-nhap" value={String(p.linkHref ?? "")} placeholder="bỏ trống = không link" onChange={(e) => props({ linkHref: e.target.value.trim() || null })} /></label>
          <div className="keo-tha-hang">
            <label>Rộng (px)<input type="number" className="o-nhap so" value={p.width ? Number(p.width) : ""} placeholder="tự động" onChange={(e) => props({ width: e.target.value ? Number(e.target.value) : null })} /></label>
            <label>Cao (px)<input type="number" className="o-nhap so" value={p.height ? Number(p.height) : ""} placeholder="tự động" onChange={(e) => props({ height: e.target.value ? Number(e.target.value) : null })} /></label>
          </div>
        </>}
        {k.type === "Divider" && <div className="keo-tha-hang">
          <ONhapMau nhan="Màu kẻ" gia={p.lineColor} onDoi={(v) => props({ lineColor: v })} />
          <ONhapSo nhan="Dày (px)" gia={p.lineHeight ?? 1} onDoi={(v) => props({ lineHeight: v })} min={1} max={20} />
        </div>}
        {k.type === "Spacer" && <ONhapSo nhan="Chiều cao (px)" gia={p.height ?? 16} onDoi={(v) => props({ height: v })} min={4} max={200} />}
        {k.type === "Html" && <label>Mã HTML (không script)<textarea className="o-nhap" rows={7} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={String(p.contents ?? "")} onChange={(e) => props({ contents: e.target.value })} /></label>}
        {k.type === "ColumnsContainer" && <>
          <div className="keo-tha-hang">
            <label>Số cột<select className="o-nhap" value={String(p.columnsCount ?? 2)} onChange={(e) => onDoc(doiSoCot(doc, id, e.target.value === "3" ? 3 : 2))}>
              <option value="2">2 cột</option><option value="3">3 cột</option></select></label>
            <ONhapSo nhan="Khoảng cách cột" gia={p.columnsGap ?? 16} onDoi={(v) => props({ columnsGap: v })} max={64} />
          </div>
          <label>Căn dọc<select className="o-nhap" value={String(p.contentAlignment ?? "top")} onChange={(e) => props({ contentAlignment: e.target.value })}>
            <option value="top">Trên</option><option value="middle">Giữa</option><option value="bottom">Dưới</option></select></label>
          <p className="text-[11px] text-muted">Cột dựng bằng bảng: Outlook giữ cột, điện thoại có thể thu nhỏ chữ.</p>
        </>}
        {k.type === "Container" && <>
          <ONhapMau nhan="Màu viền" gia={st.borderColor} onDoi={(v) => style({ borderColor: v })} choPhepTrong />
          <ONhapSo nhan="Bo góc (px)" gia={st.borderRadius ?? 0} onDoi={(v) => style({ borderRadius: v })} max={40} />
        </>}
        {laChu && (
          <div className="keo-tha-hang">
            {(k.type !== "Button") && <ONhapMau nhan="Màu chữ" gia={st.color} onDoi={(v) => style({ color: v })} />}
            <label>Đậm<select className="o-nhap" value={String(st.fontWeight ?? (k.type === "Text" ? "normal" : "bold"))} onChange={(e) => style({ fontWeight: e.target.value })}>
              <option value="normal">Thường</option><option value="bold">Đậm</option></select></label>
          </div>
        )}
        {laChu && (
          <label>Font riêng<select className="o-nhap" value={String(st.fontFamily ?? "")} onChange={(e) => style({ fontFamily: e.target.value || null })}>
            <option value="">Theo email</option>{FONT_KEO_THA.map((f) => <option key={f.ma} value={f.ma}>{f.ten}</option>)}</select></label>
        )}
        {["Heading", "Text", "Button", "Image"].includes(k.type) && <ChonCan gia={st.textAlign} onDoi={(v) => style({ textAlign: v })} />}
        {k.type !== "EmailLayout" && k.type !== "Spacer" && <>
          {k.type !== "Container" && <ONhapMau nhan="Màu nền khối" gia={st.backgroundColor} onDoi={(v) => style({ backgroundColor: v })} choPhepTrong />}
          {k.type === "Container" && <ONhapMau nhan="Màu nền khung" gia={st.backgroundColor} onDoi={(v) => style({ backgroundColor: v })} choPhepTrong />}
          <ODem k={k} onDoi={(d) => style({ padding: d })} />
        </>}
        {laChu && (
          <label>Chèn biến vào nội dung
            <select className="o-nhap" value="" onChange={(e) => { if (e.target.value) chenBien(e.target.value); }} aria-label="Chèn biến">
              <option value="">Chọn biến…</option>
              {BIEN_EMAIL.filter((b) => b.ma !== "link_huy_nhan").map((b) => <option key={b.ma} value={b.ma}>{`{{${b.ma}}}`} · {b.ten}</option>)}
            </select></label>
        )}
      </fieldset>
    </div>
  );
}

// ---------- Trình soạn ----------
/** Va chạm: ưu tiên ngăn/khối NHỎ NHẤT đang chứa con trỏ (khối lồng nhau), không có thì giao nhau hình chữ nhật. */
const vaCham: CollisionDetection = (args) => {
  const trong = pointerWithin(args);
  if (trong.length) {
    const theoDienTich = [...trong].sort((a, b) => {
      const ra = args.droppableRects.get(a.id), rb = args.droppableRects.get(b.id);
      return (ra ? ra.width * ra.height : Infinity) - (rb ? rb.width * rb.height : Infinity);
    });
    return theoDienTich;
  }
  return rectIntersection(args);
};

function SoanEmailKeoThaEditor({ taiLieu, onDoi, chiDoc = false, rong }: SoanKeoThaProps) {
  const [chonId, setChonId] = useState<string | null>(null);
  const [dangKeo, setDangKeo] = useState<{ id: string; ten: string } | null>(null);
  const lichSu = useRef<TaiLieuKeoTha[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const datDoc = useCallback((d: TaiLieuKeoTha) => {
    if (d === taiLieu) return;
    lichSu.current = [...lichSu.current.slice(-29), taiLieu];
    onDoi(d);
  }, [taiLieu, onDoi]);
  const hoanTac = () => { const t = lichSu.current.pop(); if (t) onDoi(t); };

  const themCuoi = (ma: MaKhoiKeoTha) => { const { doc, id } = chenKhoi(taiLieu, taoKhoi(ma), { chaId: GOC, cot: 0 }); datDoc(doc); setChonId(id); };
  const chenBien = (ma: string) => {
    if (!chonId) return;
    const k = taiLieu[chonId];
    if (!k || !["Heading", "Text", "Button"].includes(k.type)) return;
    const b = BIEN_EMAIL.find((x) => x.ma === ma);
    const bien = b?.duPhong ? `{{${ma}|${b.duPhong}}}` : `{{${ma}}}`;
    datDoc(capNhatKhoi(taiLieu, chonId, { props: { text: `${String(k.data.props?.text ?? "")}${String(k.data.props?.text ?? "").endsWith(" ") || !k.data.props?.text ? "" : " "}${bien}` } }));
  };

  function batDauKeo(e: DragStartEvent) {
    const d = e.active.data.current as { loai: string; ma?: MaKhoiKeoTha; id?: string } | undefined;
    if (d?.loai === "moi" && d.ma) setDangKeo({ id: String(e.active.id), ten: BANG_KHOI.find((b) => b.ma === d.ma)?.ten ?? "Khối" });
    else if (d?.id) setDangKeo({ id: d.id, ten: tenKhoi(taiLieu[d.id]) });
  }
  function ketThucKeo(e: DragEndEvent) {
    setDangKeo(null);
    const { active, over } = e;
    if (!over || chiDoc) return;
    const a = active.data.current as { loai: string; ma?: MaKhoiKeoTha; id?: string } | undefined;
    const o = over.data.current as { loai: string; chaId?: string; cot?: number; id?: string } | undefined;
    if (!a || !o) return;
    let dich: { chaId: string; cot: number; viTri?: number } | null = null;
    if (o.loai === "vung" && o.chaId !== undefined && o.cot !== undefined) dich = { chaId: o.chaId, cot: o.cot };
    else if (o.loai === "khoi" && o.id) {
      const cha = timCha(taiLieu, o.id);
      if (!cha) return;
      dich = { chaId: cha.chaId, cot: cha.cot, viTri: cha.viTri };
    }
    if (!dich) return;
    if (a.loai === "moi" && a.ma) {
      const { doc, id } = chenKhoi(taiLieu, taoKhoi(a.ma), dich);
      datDoc(doc); setChonId(id);
      return;
    }
    if (a.loai === "khoi" && a.id) {
      if (a.id === o.id) return;
      // thả lên chính con cháu của nó → bỏ qua (diChuyenKhoi cũng tự chặn)
      if (dich.chaId === a.id || conChau(taiLieu, a.id).includes(dich.chaId)) return;
      const cu = timCha(taiLieu, a.id);
      let viTri = dich.viTri;
      // kéo trong cùng ngăn xuống dưới: thả lên khối B thì đứng SAU B (giống arrayMove của dnd-kit)
      if (viTri !== undefined && cu && cu.chaId === dich.chaId && cu.cot === dich.cot && cu.viTri < viTri) viTri += 1;
      datDoc(diChuyenKhoi(taiLieu, a.id, { ...dich, viTri }));
      setChonId(a.id);
    }
  }

  const goc = taiLieu[GOC];
  const nc: NguCanh = useMemo(() => ({
    doc: taiLieu, chonId, chiDoc, dangKeoId: dangKeo?.id ?? null,
    chon: setChonId,
    xoa: (id) => { datDoc(xoaKhoi(taiLieu, id)); if (chonId === id) setChonId(null); },
    nhanBan: (id) => { const r = nhanBanKhoi(taiLieu, id); datDoc(r.doc); setChonId(r.id); },
  }), [taiLieu, chonId, chiDoc, dangKeo, datDoc]);

  return (
    <DndContext sensors={sensors} collisionDetection={vaCham} onDragStart={batDauKeo} onDragEnd={ketThucKeo} onDragCancel={() => setDangKeo(null)}
      autoScroll={{ threshold: { x: 0.12, y: 0.12 } }} /* mặc định 20% mép viewport → vừa nhấn kéo ở bảng khối là trang trôi */>
      <div className="keo-tha-vo" data-soan-keo-tha>
        <aside className="keo-tha-bang" aria-label="Bảng khối">
          <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Khối</span>
            {!chiDoc && <button type="button" className="keo-tha-nut" onClick={hoanTac} title="Hoàn tác (Ctrl+Z)" disabled={lichSu.current.length === 0}>↶ Hoàn tác</button>}
          </div>
          <p className="text-[11px] text-muted -mt-1">Kéo vào email; bấm đúp để thêm vào cuối.</p>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted mt-1">Nội dung</span>
          {BANG_KHOI.filter((b) => b.nhom === "noi_dung").map((b) => <MucBang key={b.ma} ma={b.ma} ten={b.ten} moTa={b.moTa} chiDoc={chiDoc} onThem={() => themCuoi(b.ma)} />)}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted mt-1">Bố cục</span>
          {BANG_KHOI.filter((b) => b.nhom === "bo_cuc").map((b) => <MucBang key={b.ma} ma={b.ma} ten={b.ten} moTa={b.moTa} chiDoc={chiDoc} onThem={() => themCuoi(b.ma)} />)}
        </aside>

        <div className="keo-tha-canvas" style={{ background: String(goc?.data.backdropColor ?? "#f3f4f6") }} onClick={() => setChonId(GOC)} role="region" aria-label="Canvas email">
          <div className="keo-tha-email" style={{ maxWidth: rong, fontFamily: FONT_CSS[String(goc?.data.fontFamily ?? "MODERN_SANS")], color: String(goc?.data.textColor ?? "#1f2937"), fontSize: 16 }}>
            <div className={`keo-tha-than ${chonId === GOC ? "chon" : ""}`} style={{ background: String(goc?.data.canvasColor ?? "#ffffff"), borderColor: (goc?.data.borderColor as string) ?? "transparent", borderRadius: Number(goc?.data.borderRadius ?? 0), outline: chonId === GOC ? "2px solid var(--info)" : undefined }}>
              <VungChua chaId={GOC} cot={0} ids={cacNganCon(goc)[0] ?? []} nc={nc} style={{ minHeight: 120 }} />
            </div>
            <p className="text-center text-[11px] mt-2" style={{ color: "#94a3b8" }}>Footer hủy nhận + tên người gửi được hệ thống tự thêm khi gửi, không xoá được.</p>
          </div>
        </div>

        <BangThuocTinh doc={taiLieu} id={chonId} onDoc={datDoc} chiDoc={chiDoc} chenBien={chenBien} />
      </div>
      <DragOverlay dropAnimation={null}>{dangKeo ? <div className="keo-tha-ghost">{dangKeo.ten}</div> : null}</DragOverlay>
    </DndContext>
  );
}

// ---------- Vỏ: thanh công cụ (mẫu · Máy tính/Điện thoại) + trình soạn ----------
/** value null → tài liệu trống (taoTaiLieuTrong). Component điều khiển: mọi thay đổi đi ra qua onChange. */
export function DndEditor({ value, onChange }: { value: any; onChange: (doc: any) => void }) {
  const [rong, setRong] = useState<600 | 375>(600);
  // tài liệu trống tạo một lần, giữ id ổn định cho tới khi trang cha nhận onChange đầu tiên
  const trong = useMemo(() => taoTaiLieuTrong(), []);
  const doc: TaiLieuKeoTha = value && typeof value === "object" && value[GOC] ? (value as TaiLieuKeoTha) : trong;
  const kiem = useMemo(() => kiemJsonKeoTha(doc), [doc]);

  function apMau(ma: string) {
    const m = MAU_EMAIL_KEO_THA.find((x) => x.ma === ma);
    if (!m) return;
    if (Object.keys(doc).length > 1 && !window.confirm("Thay bằng mẫu này? Toàn bộ nội dung đang soạn sẽ bị thay.")) return;
    onChange(JSON.parse(JSON.stringify(m.noiDungKeoTha)) as TaiLieuKeoTha);
  }

  return (
    <div className="flex flex-col gap-2" data-vo-keo-tha>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="min-h-9 max-w-[260px] rounded-xl border border-line-strong bg-card px-3 py-1.5 text-sm text-ink" defaultValue="" onChange={(e) => { apMau(e.target.value); e.target.value = ""; }} aria-label="Chọn mẫu kéo thả">
          <option value="">Chọn mẫu kéo thả…</option>
          {NHOM_MAU_KHOI.map((n) => {
            const ds = MAU_EMAIL_KEO_THA.filter((m) => m.nhom === n.ma);
            return ds.length ? <optgroup key={n.ma} label={`Mẫu kéo thả · ${n.ten}`}>{ds.map((m) => <option key={m.ma} value={m.ma}>{m.ten}</option>)}</optgroup> : null;
          })}
        </select>
        <span className="keo-tha-can" role="group" aria-label="Kích thước xem">
          <button type="button" aria-pressed={rong === 600} onClick={() => setRong(600)}>Máy tính</button>
          <button type="button" aria-pressed={rong === 375} onClick={() => setRong(375)}>Điện thoại</button>
        </span>
      </div>
      {!kiem.ok && <p className="text-xs text-warn-ink">Chưa lưu được: {kiem.loi[0]}</p>}
      <SoanEmailKeoThaEditor taiLieu={doc} onDoi={onChange} rong={rong} />
    </div>
  );
}
