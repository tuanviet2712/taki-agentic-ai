// SOẠN EMAIL THEO KHỐI — port từ auto-funnel components/soan-email-khoi(-editor).tsx.
// Bọc TRỰC TIẾP Editor của @maily-to/core (MIT); JSON Tiptap đi ra qua onChange. Nhãn khối (slash «/») dịch tiếng Việt
// qua prop `blocks`; bubble menu và popover bên trong thư viện vẫn tiếng Anh (thư viện không cho đổi).
// Bản gốc có Xem trước / Gửi thử bằng server action — ở đây trang cha tự lo (component chỉ soạn).
// Nạp bằng React.lazy (EmailComposer): Tiptap + tippy.js nặng, tách chunk riêng.
import "@maily-to/core/style.css";
import "./email-editor.css";
import { Editor, type EditorProps } from "@maily-to/core";
import * as K from "@maily-to/core/blocks";
import type { BlockGroupItem, BlockItem } from "@maily-to/core/blocks";
import { MailyKit, PlaceholderExtension, VariableExtension, getVariableSuggestions } from "@maily-to/core/extensions";
import { useMemo, useRef } from "react";
import { BIEN_EMAIL, MAU_EMAIL_KHOI, NHOM_MAU_KHOI, type KhoiJson } from "@dotaka/email/web";
import { cx, inputCls } from "../ui";

export type TiptapEditor = Parameters<NonNullable<EditorProps["onCreate"]>>[0];

const RONG = { type: "doc", content: [{ type: "paragraph", content: [] }] } as KhoiJson;

const vi = (b: BlockItem, title: string, description: string, them: string[] = []): BlockItem =>
  ({ ...b, title, description, searchTerms: [...(b.searchTerms ?? []), ...them] }) as BlockItem;

/** Nhóm khối hiện khi gõ «/» — tên tiếng Việt, từ khoá tìm giữ cả tiếng Anh lẫn không dấu. */
const KHOI_VI: BlockGroupItem[] = [
  { title: "Nội dung", commands: [
    vi(K.text, "Văn bản", "Đoạn chữ thường", ["van ban", "doan"]),
    vi(K.heading1, "Tiêu đề lớn", "Heading 1", ["tieu de"]),
    vi(K.heading2, "Tiêu đề vừa", "Heading 2", ["tieu de"]),
    vi(K.heading3, "Tiêu đề nhỏ", "Heading 3", ["tieu de"]),
    vi(K.bulletList, "Danh sách chấm", "Gạch đầu dòng", ["danh sach"]),
    vi(K.orderedList, "Danh sách số", "Đánh số 1, 2, 3", ["danh sach"]),
    vi(K.blockquote, "Trích dẫn", "Lời khách, lời chuyên gia", ["trich dan"]),
    vi(K.hardBreak, "Xuống dòng", "Ngắt dòng trong đoạn", ["xuong dong"]),
  ] },
  { title: "Khối", commands: [
    vi(K.button, "Nút CTA", "Nút bấm có link", ["nut", "cta"]),
    vi(K.image, "Ảnh", "Ảnh từ URL hoặc tải lên", ["anh", "hinh"]),
    vi(K.logo, "Logo", "Logo thương hiệu", ["logo"]),
    vi(K.divider, "Đường kẻ", "Kẻ ngang phân đoạn", ["duong ke"]),
    vi(K.spacer, "Khoảng trống", "Cách đoạn theo pixel", ["khoang trong"]),
    vi(K.section, "Khung nền", "Khối có nền và viền riêng", ["khung"]),
    vi(K.columns, "Cột", "Chia 2 đến 3 cột (Outlook tự dồn 1 cột trên mobile)", ["cot"]),
    vi(K.linkCard, "Thẻ liên kết", "Ảnh + tiêu đề + mô tả + link", ["the lien ket"]),
    vi(K.footer, "Chân thư", "Chữ nhỏ cuối thư (footer hủy nhận hệ thống vẫn tự thêm)", ["chan thu", "footer"]),
    vi(K.clearLine, "Xoá dòng", "Xoá dòng hiện tại", ["xoa"]),
  ] },
];

const chonCls = cx(inputCls, "!w-auto !min-h-9 !py-1.5 max-w-[260px]");

export function BlockEditor({ value, onChange }: { value: any; onChange: (doc: any) => void }) {
  const editorRef = useRef<TiptapEditor | null>(null);
  // Editor của maily là KHÔNG điều khiển: chỉ đọc `value` lúc mount; thay nội dung về sau đi qua setContent.
  const banDau = useMemo<KhoiJson>(() => (value && value.type === "doc" ? value : RONG), []); // eslint-disable-line react-hooks/exhaustive-deps

  const extensions = useMemo(() => [
    MailyKit.configure({ repeat: false }),
    PlaceholderExtension.configure({
      includeChildren: true,
      placeholder: ({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } }) => {
        if (node.type.name === "heading") return `Tiêu đề ${node.attrs.level ?? ""}`;
        if (["columns", "column", "section", "repeat", "show", "blockquote", "htmlCodeBlock"].includes(node.type.name)) return "";
        return "Gõ chữ, hoặc gõ / để chèn khối, @ để chèn biến";
      },
    }),
    VariableExtension.configure({
      suggestion: getVariableSuggestions("@"),
      variables: BIEN_EMAIL.map((b) => ({ name: b.ma, required: false, label: b.ten })),
    }),
  ], []);

  function apMau(ma: string) {
    const m = MAU_EMAIL_KHOI.find((x) => x.ma === ma);
    const e = editorRef.current;
    if (!m || !e) return;
    if (e.getText().trim().length > 0 && !window.confirm("Thay bằng mẫu này? Toàn bộ nội dung đang soạn sẽ bị thay.")) return;
    e.commands.setContent(m.noiDungKhoi as never);
    onChange(e.getJSON());
  }

  // Biến chèn dạng node `variable` — khi render ra {{ma|du_phong}} (quy ước của email-khoi)
  function chenBien(ma: string) {
    const b = BIEN_EMAIL.find((x) => x.ma === ma);
    if (!b || !editorRef.current) return;
    editorRef.current.chain().focus().insertContent({ type: "variable", attrs: { id: b.ma, label: b.ma, fallback: b.duPhong || null, required: false } }).run();
  }

  return (
    <div className="soan-khoi flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={chonCls} defaultValue="" onChange={(e) => { apMau(e.target.value); e.target.value = ""; }} aria-label="Chọn mẫu">
          <option value="">Chọn mẫu…</option>
          {NHOM_MAU_KHOI.map((n) => {
            const ds = MAU_EMAIL_KHOI.filter((m) => m.nhom === n.ma);
            return ds.length ? <optgroup key={n.ma} label={`Mẫu khối · ${n.ten}`}>{ds.map((m) => <option key={m.ma} value={m.ma}>{m.ten}</option>)}</optgroup> : null;
          })}
        </select>
        <select className={chonCls} defaultValue="" onChange={(e) => { chenBien(e.target.value); e.target.value = ""; }} aria-label="Chèn biến">
          <option value="">Chèn biến…</option>
          {BIEN_EMAIL.map((b) => <option key={b.ma} value={b.ma}>{`{{${b.ma}}}`} · {b.ten}</option>)}
        </select>
      </div>
      <Editor
        contentJson={banDau as never}
        blocks={KHOI_VI}
        extensions={extensions}
        onCreate={(e) => { editorRef.current = e; }}
        onUpdate={(e) => { editorRef.current = e; onChange(e.getJSON()); }}
        config={{ hasMenuBar: false, spellCheck: false, autofocus: false, immediatelyRender: false, wrapClassName: "soan-khoi-vo", bodyClassName: "soan-khoi-than", contentClassName: "soan-khoi-noi-dung" }}
      />
      <p className="text-xs text-muted">Gõ <b>/</b> để chèn khối, <b>@</b> để chèn biến. Email ra dạng bảng, có khối MSO cho Outlook; footer hủy nhận tự thêm, không xoá được.</p>
    </div>
  );
}
