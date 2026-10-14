import { useState } from "react";
import { ImagePlus, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Button, cx, inputCls, useToast } from "./ui";

/**
 * Ảnh đi kèm bài viết (mục Duyệt + trang Nội dung): xem ảnh sẽ đăng cùng bài, tạo lại bằng kết nối AI đang chọn
 * (Claude thiết kế / ChatGPT tạo ảnh), dùng ảnh của Sếp, hoặc gỡ ảnh. Máy chủ: /v1/content/:id/image.
 */
export type PostImageInfo = {
  supported: boolean; enabled: boolean; engine: "chatgpt" | "claude" | "gemini_flow" | null; engineReason: string | null; locked: boolean;
  asset: { id: string; width: number | null; height: number | null; source: string; engine: string | null; model: string | null; alt: string | null; stale: boolean; createdAt: string; fallbackFrom?: string | null; fallbackError?: string | null } | null;
} | null | undefined;

const ENGINE: Record<string, string> = { chatgpt: "ChatGPT tạo ảnh", claude: "Claude thiết kế", gemini_flow: "Gemini (Flow) tạo ảnh" };
const toData = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Không đọc được tệp")); r.readAsDataURL(f); });

export function PostImage({ contentId, image, error, onChange, compact }: { contentId: string; image: PostImageInfo; error?: string | null; onChange: () => void; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"make" | "upload" | "remove" | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  if (!image?.supported) return null;
  const a = image.asset;
  const canMake = !!image.engine && !image.locked;
  const engineLabel = image.engine ? ENGINE[image.engine] : null;

  const run = async (k: "make" | "upload" | "remove", fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try { await fn(); toast(ok); onChange(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const make = () => run("make", async () => { await api.post(`content/${contentId}/image`, note.trim() ? { note: note.trim() } : {}); setAsking(false); setNote(""); }, "Đã tạo ảnh cho bài viết");
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(png|jpe?g)$/i.test(f.name)) { toast("Chỉ nhận ảnh JPG hoặc PNG", "err"); return; }
    await run("upload", async () => { const up = await api.post("/v1/uploads", { name: f.name, data: await toData(f) }); await api.put(`content/${contentId}/image`, { path: up.path }); }, "Đã dùng ảnh của Sếp cho bài viết");
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ImagePlus className="h-4 w-4 text-blue-600" />Ảnh đăng kèm bài</p>
        {a ? <Badge tone={a.source === "upload" ? "blue" : "violet"}>{a.source === "upload" ? "Ảnh của Sếp" : ENGINE[a.engine ?? ""] ?? "Ảnh AI"}</Badge> : <Badge tone="gray">Chưa có ảnh</Badge>}
        {a?.fallbackFrom && <Badge tone="amber"><span title={a.fallbackError ?? ""}>Dự phòng — {ENGINE[a.fallbackFrom] ?? a.fallbackFrom} lỗi</span></Badge>}
        {a?.stale && <Badge tone="amber">Nội dung đã đổi sau khi tạo ảnh</Badge>}
        {image.locked && <Badge tone="gray">Đã lên lịch / đã đăng</Badge>}
      </div>

      {a ? (
        <div className={cx("mt-3 flex flex-col gap-3", !compact && "sm:flex-row sm:items-start")}>
          <a href={`/v1/media/${a.id}`} target="_blank" rel="noreferrer" className="block shrink-0" title="Mở ảnh cỡ đầy đủ">
            <img src={`/v1/media/${a.id}`} alt={a.alt ?? "Ảnh đăng kèm bài viết"} loading="lazy"
              className={cx("rounded-lg border border-line bg-soft object-contain", compact ? "max-h-72 w-full" : "max-h-80 w-full sm:w-56")} />
          </a>
          <div className="min-w-0 flex-1 space-y-1 text-xs text-muted">
            <p>Ảnh này được đăng CÙNG bài viết khi Sếp duyệt.{a.width && a.height ? ` Kích thước ${a.width}×${a.height}.` : ""}</p>
            {a.alt && <p className="line-clamp-2">Mô tả: {a.alt}</p>}
            {a.model && a.source !== "upload" && <p>Model: {a.model}</p>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          {error ? <span className="text-amber-700 dark:text-amber-300">Chưa tạo được ảnh: {error} </span> : null}
          {!image.enabled ? "Tự tạo ảnh đang tắt trong Cài đặt — bài sẽ đăng chỉ có chữ, trừ khi Sếp tạo hoặc tải ảnh ở đây." : !image.engine ? (image.engineReason ?? "Chưa có kết nối AI để tạo ảnh.") : "Bài này chưa có ảnh — nếu duyệt bây giờ, bài đăng chỉ có chữ."}
        </p>
      )}

      {!image.locked && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={a ? "secondary" : "primary"} icon={a ? RefreshCw : Sparkles} loading={busy === "make"} disabled={!canMake || busy !== null}
              title={canMake ? `${engineLabel} (khoảng 1 phút)` : image.engineReason ?? ""} onClick={() => (asking || !a ? make() : setAsking(true))}>
              {busy === "make" ? "Đang tạo ảnh (~1 phút)…" : asking && a ? "Tạo ảnh mới" : a ? "Tạo lại ảnh" : "Tạo ảnh"}
            </Button>
            <label className={cx("inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-card px-3 text-sm font-medium text-ink hover:bg-soft", busy !== null && "pointer-events-none opacity-50")}>
              <Upload className="h-4 w-4" />{busy === "upload" ? "Đang tải…" : "Dùng ảnh của tôi"}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {a && <Button size="sm" variant="ghost" icon={Trash2} loading={busy === "remove"} disabled={busy !== null} onClick={() => run("remove", () => api.del(`content/${contentId}/image`), "Đã gỡ ảnh — bài đăng chỉ còn chữ")}>Gỡ ảnh</Button>}
            {engineLabel && <span className="text-[11px] text-muted">Ảnh mới: {engineLabel}</span>}
          </div>
          {asking && a && (
            <div className="flex flex-wrap items-center gap-2">
              <input autoFocus className={cx(inputCls, "h-8 min-w-0 flex-1 py-1 text-xs")} placeholder="Góp ý cho ảnh mới (không bắt buộc) — vd: nền sáng hơn, minh hoạ đội nhóm" value={note} maxLength={600}
                onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void make(); if (e.key === "Escape") setAsking(false); }} />
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setAsking(false)}>Hủy</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
