import { useState } from "react";
import { Download, ImagePlus, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Button, useToast } from "./ui";

/**
 * Bộ ảnh của bài SEO: cứ 1000 chữ có tối thiểu 4 ảnh, đặt ở vị trí tối ưu SEO (ảnh đầu bài sau đoạn mở đầu, các ảnh còn lại
 * chia đều, mỗi ảnh sau đoạn văn đầu của một mục). Ảnh nằm TRONG thân bài; tạo lại / bù ảnh còn thiếu chạy nền vài phút.
 * Máy chủ: /v1/content/:id/seo-images (POST), /v1/content/:id/export (tải .zip: html + md + images/).
 */
export type SeoImagesInfo = {
  supported: boolean; words: number; required: number; have: number; missing: number; wordsPerImage: number; minImages: number;
  engine: "chatgpt" | "claude" | "gemini_flow" | null; engineReason: string | null; locked: boolean; liveUrl?: string | null; busy: boolean; progress: { done: number; total: number } | null;
  images: { id: string; alt: string; heading: string; afterWords: number; width: number | null; height: number | null; filename: string; role: string | null }[];
} | null | undefined;

export function SeoImages({ contentId, info, error, onChange }: { contentId: string; info: SeoImagesInfo; error?: string | null; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"fill" | "all" | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  if (!info?.supported) return null;
  const ok = info.missing === 0;
  const canMake = !!info.engine && !info.locked && !info.busy && busy === null;
  const run = async (k: "fill" | "all") => {
    setBusy(k);
    try {
      await api.post(`content/${contentId}/seo-images`, k === "all" ? { replaceAll: true } : {});
      toast(k === "all" ? "Đã xếp việc tạo lại toàn bộ ảnh — vài phút, ảnh sẽ tự hiện" : "Đã xếp việc tạo ảnh còn thiếu — vài phút, ảnh sẽ tự hiện");
      setConfirmAll(false);
      onChange();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ImagePlus className="h-4 w-4 text-blue-600" />Ảnh trong bài SEO</p>
        <Badge tone={ok ? "green" : "amber"}>{info.have}/{info.required} ảnh</Badge>
        <span className="text-xs text-muted">{info.words.toLocaleString("vi-VN")} chữ → tối thiểu {info.required} ảnh (4 ảnh / 1000 chữ)</span>
        {info.locked && <Badge tone="gray">Đã lên lịch / đã đăng</Badge>}
        {!info.locked && info.liveUrl && <Badge tone="green"><span title="Tạo ảnh xong, hệ thống tự cập nhật bài trên website (thêm ảnh + ảnh đại diện), giữ nguyên đường dẫn">Đã lên website · tạo ảnh xong tự cập nhật bài</span></Badge>}
      </div>

      {info.busy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {info.progress && info.progress.total > 0 ? `Đang tạo ảnh ${Math.min(info.progress.done + 1, info.progress.total)}/${info.progress.total}… (mỗi ảnh khoảng 1 phút)` : "Đang xếp hàng tạo ảnh…"}
        </p>
      )}
      {!info.busy && !ok && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {error ? `${error} ` : `Bài đang thiếu ${info.missing} ảnh. `}
          {!info.engine ? (info.engineReason ?? "Chưa có kết nối AI để tạo ảnh.") : ""}
        </p>
      )}

      {info.images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {info.images.map((x, i) => (
            <a key={x.id} href={`/v1/media/${x.id}`} target="_blank" rel="noreferrer" className="group block min-w-0" title={x.alt}>
              <img src={`/v1/media/${x.id}`} alt={x.alt} loading="lazy" className="aspect-video w-full rounded-lg border border-line bg-soft object-cover" />
              <p className="mt-1 truncate text-[11px] font-medium text-ink">{i === 0 && x.afterWords <= 150 ? "Ảnh đầu bài" : `Dưới mục: ${x.heading || "—"}`}</p>
              <p className="truncate text-[11px] text-muted">{x.filename}</p>
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {info.missing > 0 && (
          <Button size="sm" variant="primary" icon={Sparkles} loading={busy === "fill"} disabled={!canMake} title={info.engineReason ?? ""} onClick={() => run("fill")}>Tạo ảnh còn thiếu ({info.missing})</Button>
        )}
        {!confirmAll ? (
          <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!canMake || info.have === 0} onClick={() => setConfirmAll(true)}>Tạo lại toàn bộ ảnh</Button>
        ) : (
          <>
            <Button size="sm" variant="danger" loading={busy === "all"} disabled={!canMake} onClick={() => run("all")}>Xác nhận: thay hết {info.have} ảnh</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Hủy</Button>
          </>
        )}
        {info.have > 0 && <a href={`/v1/content/${contentId}/export`} download><Button size="sm" variant="secondary" icon={Download}>Tải bài + ảnh (.zip)</Button></a>}
      </div>
      <p className="mt-2 text-[11px] text-muted">Muốn đổi riêng 1 ảnh: bấm Chỉnh sửa, xoá dòng ảnh đó (dòng bắt đầu bằng <code>![</code>) rồi bấm "Tạo ảnh còn thiếu". Gói .zip có HTML chuẩn SEO + thư mục images/ đặt tên theo từ khoá để đưa lên website.</p>
    </div>
  );
}
