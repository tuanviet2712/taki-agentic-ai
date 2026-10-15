// Ô SOẠN EMAIL 3 chế độ — port vỏ tab từ auto-funnel components/soan-email-khoi.tsx (SoanEmailKhoi).
// «Văn bản» (textarea thuần) · «Khối» (maily.to, Tiptap JSON) · «Kéo thả» (dnd-kit, tài liệu email-builder).
// Component điều khiển hoàn toàn: trang cha giữ mode/body/data và lưu; chế độ đang chọn quyết định nội dung gửi đi.
// Hai trình soạn nặng nạp bằng React.lazy để tách chunk.
import { lazy, Suspense } from "react";
import { vanBanSangKhoi } from "@dotaka/email/web";
import { Tabs, cx, inputCls } from "../ui";

const BlockEditor = lazy(() => import("./BlockEditor").then((m) => ({ default: m.BlockEditor })));
const DndEditor = lazy(() => import("./DndEditor").then((m) => ({ default: m.DndEditor })));

export type CheDoSoan = "text" | "blocks" | "dnd";

const TABS: { value: CheDoSoan; label: string }[] = [
  { value: "text", label: "Văn bản" },
  { value: "blocks", label: "Khối" },
  { value: "dnd", label: "Kéo thả" },
];

/** data rỗng = null, hoặc không đúng loại với chế độ (doc Tiptap cho Khối, tài liệu có `root` cho Kéo thả). */
const laKhoi = (d: any) => !!d && typeof d === "object" && d.type === "doc";
const laKeoTha = (d: any) => !!d && typeof d === "object" && !!d.root;

export function EmailComposer({ mode, onModeChange, body, data, onBody, onData }: {
  mode: CheDoSoan;
  onModeChange: (m: CheDoSoan) => void;
  body: string;
  data: any;
  onBody: (s: string) => void;
  onData: (d: any) => void;
}) {
  function doiTab(m: CheDoSoan) {
    if (m === mode) return;
    // Văn bản → Khối khi chưa có khối: đổi văn bản sang JSON khối để khỏi gõ lại
    if (m === "blocks" && !laKhoi(data)) onData(body.trim() ? vanBanSangKhoi(body) : null);
    else if (m === "dnd" && !laKeoTha(data)) onData(null);
    onModeChange(m);
  }

  const dangNap = <div className="h-[320px] animate-pulse rounded-xl bg-soft" aria-label="Đang nạp trình soạn" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Tabs tabs={TABS} value={mode} onChange={doiTab} className="flex-1" />
        <span className="pb-2 text-xs text-muted">Lưu ở chế độ nào thì nội dung gửi đi lấy theo chế độ đó.</span>
      </div>

      {mode === "text" && (
        <div className="flex flex-col gap-1.5">
          <textarea rows={10} value={body} onChange={(e) => onBody(e.target.value)} className={cx(inputCls, "font-mono !text-[13px] leading-relaxed")}
            placeholder={"Chào {{ho_ten|bạn}},\n\n…"} />
          <p className="text-xs text-muted">
            Dùng biến dạng <code className="rounded bg-soft px-1">{"{{ho_ten|bạn}}"}</code> (sau dấu | là chữ thay thế khi thiếu dữ liệu).
            Link https://… trong thư tự đổi thành link theo dõi lượt bấm khi gửi.
          </p>
        </div>
      )}

      {/* key theo chế độ: đổi tab là mount lại, BlockEditor đọc value lúc mount */}
      {mode === "blocks" && (
        <Suspense fallback={dangNap}>
          <BlockEditor key="blocks" value={laKhoi(data) ? data : null} onChange={onData} />
        </Suspense>
      )}
      {mode === "dnd" && (
        <Suspense fallback={dangNap}>
          <DndEditor key="dnd" value={laKeoTha(data) ? data : null} onChange={onData} />
        </Suspense>
      )}
    </div>
  );
}
