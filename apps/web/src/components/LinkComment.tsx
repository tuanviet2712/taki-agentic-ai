import { useEffect, useState } from "react";
import { Link2, Loader2, MessageSquarePlus, RefreshCw, Settings2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PlatformIcon, Toggle, cx, inputCls, useToast } from "./ui";

/**
 * "Gắn link dưới bình luận" trên trang Đăng bài: trạng thái từng bài + gắn tay / gắn lại + bài có sẵn trên Fanpage + cài đặt tự gắn.
 * Sản phẩm lấy từ Mục tiêu & DNA (mục Sản phẩm/Dịch vụ) — không có trang "sản phẩm affiliate" riêng.
 */
const STATE: Record<string, [string, any]> = {
  attached: ["Đã gắn", "green"], pending: ["Đang gắn…", "blue"], failed: ["Lỗi", "red"], needs_check: ["Cần kiểm tra", "amber"], skipped: ["Bỏ qua", "gray"], none: ["Chưa gắn", "gray"],
};

export function LinkCommentCell({ p, onChanged }: { p: any; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const l = p.link ?? { state: "none" };
  const [label, tone] = STATE[l.state] ?? STATE.none;
  return (
    <>
      <div className="flex max-w-[200px] flex-col items-start gap-1">
        <Badge tone={tone}>{l.state === "pending" && <Loader2 className="h-3 w-3 animate-spin" />}{label}</Badge>
        {l.product?.name && <span className="line-clamp-1 text-[11px] text-muted" title={l.product.name}>{l.product.name}{l.auto ? " · tự gắn" : ""}</span>}
        {l.state === "attached" && <span className="text-[11px] text-muted">{timeAgo(l.at)}</span>}
        {["failed", "needs_check", "skipped"].includes(l.state) && l.error && <span className={cx("line-clamp-3 text-[11px]", l.state === "failed" ? "text-rose-600" : "text-amber-700 dark:text-amber-300")} title={l.error}>{l.error}</span>}
        {l.state !== "pending" && (
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
            {l.state === "attached" ? <><RefreshCw className="h-3 w-3" />Gắn lại</> : <><Link2 className="h-3 w-3" />Gắn link</>}
          </button>
        )}
      </div>
      <LinkCommentModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }}
        title={p.title} channel={p.channel} postProduct={l.product} endpoint={`posts/${p.id}/comment-link`} attached={l.state === "attached"} warnCheck={l.state === "needs_check"} />
    </>
  );
}

function LinkCommentModal({ open, onClose, onDone, title, channel, postProduct, endpoint, attached, warnCheck, extra }: {
  open: boolean; onClose: () => void; onDone: () => void; title: string; channel: string; postProduct?: { key: string; name: string; hasLink: boolean } | null;
  endpoint: string; attached?: boolean; warnCheck?: boolean; extra?: Record<string, unknown>;
}) {
  const toast = useToast();
  const dna = useApi<any>(open ? "dna" : null);
  const products: any[] = (dna.data?.data?.products ?? []).filter((x: any) => x?.name);
  const [productKey, setProductKey] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setProductKey(""); setUrl(""); setText(""); } }, [open]);
  const keyOf = (x: any) => x.key || x.name;
  const chosen = productKey ? products.find((x) => keyOf(x) === productKey) : postProduct ? products.find((x) => keyOf(x) === postProduct.key || x.name === postProduct.name) : undefined;
  const hasLink = Boolean(url.trim() || chosen?.shortLink || chosen?.link);
  const ig = channel === "instagram";
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post(endpoint, { ...(extra ?? {}), productKey: productKey || undefined, url: url.trim() || undefined, text: text.trim() || undefined });
      toast(`Đã gắn link dưới bài${r.via === "browser" ? " (qua Chrome)" : ""}`);
      onDone();
    } catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={attached ? "Gắn lại link dưới bình luận" : "Gắn link dưới bình luận"}
      footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" icon={MessageSquarePlus} loading={busy} disabled={!hasLink} onClick={go}>Gắn link</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2"><PlatformIcon p={channel} size={18} /><span className="truncate font-medium text-ink">{title}</span></p>
        <Field label="Sản phẩm" hint={postProduct ? `Bài này thuộc: ${postProduct.name}${postProduct.hasLink ? "" : " (chưa có link)"}` : "Bài này chưa biết thuộc sản phẩm nào — chọn sản phẩm hoặc nhập link bên dưới"}>
          <select className={inputCls} value={productKey} onChange={(e) => setProductKey(e.target.value)}>
            <option value="">{postProduct ? `Theo bài: ${postProduct.name}` : "— Không chọn —"}</option>
            {products.map((x) => <option key={keyOf(x)} value={keyOf(x)}>{x.name}{x.shortLink || x.link ? "" : " (chưa có link)"}</option>)}
          </select>
        </Field>
        <Field label="Hoặc nhập link khác (tuỳ chọn)" hint={chosen && (chosen.shortLink || chosen.link) ? `Bỏ trống = dùng link của sản phẩm: ${chosen.shortLink || chosen.link}` : "Link sản phẩm / landing / link affiliate (Shopee, TikTok Shop, Lazada…)"}>
          <input className={inputCls} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Nội dung bình luận (tuỳ chọn)" hint={ig ? "Link trong bình luận Instagram KHÔNG bấm được — để trống = câu mặc định hướng khách về link ở bio." : "{link} sẽ được thay bằng link (có mã đo click khi cổng công khai đang chạy). Để trống = câu của sản phẩm / câu mặc định."}>
          <textarea rows={3} className={inputCls} placeholder={chosen?.commentText || (ig ? "Link sản phẩm ở bio của {shop} 👆" : "Link {san_pham} & ưu đãi: {link}")} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {warnCheck && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">Lần gắn trước có thể ĐÃ đăng bình luận. Mở bài trên kênh kiểm tra — chỉ gắn lại khi chắc chắn chưa có.</p>}
        {attached && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">Bài đã có bình luận link — gắn lại sẽ đăng THÊM 1 bình luận mới (bình luận cũ không bị xoá).</p>}
        <p className="text-xs text-muted">Facebook: bình luận đăng bằng chính Trang; Facebook không cho ghim bình luận qua API — muốn ghim, Sếp mở bài và ghim tay. Bình luận đăng công khai ngay, không thu hồi tự động.</p>
      </div>
    </Modal>
  );
}

/** Gắn link vào bài CÓ SẴN trên Fanpage (bài Sếp tự đăng, không qua hệ thống). */
export function ExistingPostLinkCard({ onChanged }: { onChanged?: () => void }) {
  const { data: channels } = useApi<any[]>("comment-link/channels");
  const [channelId, setChannelId] = useState<string>("");
  const ch = channels?.find((c) => c.id === channelId) ?? channels?.[0];
  const { data: posts, loading } = useApi<any[]>(ch ? `pages/${ch.id}/posts` : null);
  const [pick, setPick] = useState<any | null>(null);
  const toast = useToast();
  if (!channels?.length) return null; // chưa nối Fanpage thật thì không hiện (kênh thêm tay không đọc được danh sách bài)
  return (
    <Card title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4" />Gắn link vào bài có sẵn trên Fanpage</span>}
      action={channels.length > 1 && <select className={cx(inputCls, "h-8 w-auto py-1 text-xs")} value={ch?.id ?? ""} onChange={(e) => setChannelId(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}>
      <p className="-mt-1 mb-3 text-xs text-muted">Bài Sếp tự đăng trên Facebook (không qua hệ thống) cũng gắn được link sản phẩm dưới bình luận — và hệ thống bắt đầu đo click cho bài đó.</p>
      {loading && !posts ? <Loading /> : !posts?.length ? <Empty>Fanpage chưa có bài nào.</Empty> : (
        <div className="divide-y divide-line">
          {posts.slice(0, 10).map((p) => (
            <div key={p.externalId} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1"><p className="truncate text-sm text-ink">{p.text}</p><p className="text-xs text-muted">{p.createdAt ? timeAgo(p.createdAt) : ""}{p.permalink && <> · <a href={p.permalink} target="_blank" rel="noreferrer" className="underline">xem bài</a></>}</p></div>
              <Button size="sm" icon={Link2} onClick={() => setPick(p)}>Gắn link</Button>
            </div>
          ))}
        </div>
      )}
      {pick && ch && (
        <LinkCommentModal open onClose={() => setPick(null)} onDone={() => { setPick(null); toast("Bài đã được thêm để theo dõi click", "info"); onChanged?.(); }}
          title={pick.text} channel={ch.platform} endpoint={`channels/${ch.id}/external-posts/comment-link`}
          extra={{ externalId: pick.externalId, postText: pick.text, permalink: pick.permalink, createdAt: pick.createdAt }} />
      )}
    </Card>
  );
}

/** Cài đặt tự gắn link + tình trạng đo click (địa chỉ công khai). */
export function LinkCommentSettingsCard() {
  const toast = useToast();
  const { data, reload } = useApi<any>("link-comment/settings");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const s = data.settings;
  const pub = data.public;
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try { await api.put("link-comment/settings", patch); reload(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Link sản phẩm dưới bình luận</span>}
      action={<Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Thu gọn" : "Cài đặt"}</Button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Toggle checked={s.auto} disabled={busy} onChange={(v) => save({ auto: v })} />
        <span className="text-ink">Tự gắn link sau khi đăng Facebook</span>
        <Badge tone={pub.clickTracking ? "green" : "gray"}>{pub.clickTracking ? "Đo click: bật" : "Đo click: chưa"}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">Chỉ tự gắn khi biết bài thuộc sản phẩm nào (chọn "Sản phẩm của chiến dịch" ở trang Kế hoạch, hoặc bài do Lái tự động / video của sản phẩm). Sau 30–60 giây kể từ lúc đăng. Link lấy từ Mục tiêu & DNA → Sản phẩm.</p>
      {!pub.clickTracking && pub.clickTrackingNote && <p className="mt-1 text-xs text-muted">{pub.clickTrackingNote}</p>}
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <label className="flex items-start gap-2 text-sm"><Toggle checked={s.autoGuess} disabled={busy} onChange={(v) => save({ autoGuess: v })} /><span><span className="text-ink">Đoán sản phẩm theo tên trong bài</span><span className="block text-xs text-muted">Khi không có tín hiệu rõ. Dễ gắn nhầm link dưới bài công khai — mặc định tắt.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><Toggle checked={s.fallbackMain} disabled={busy} onChange={(v) => save({ fallbackMain: v })} /><span><span className="text-ink">Không biết sản phẩm: gắn link chính của DNA</span><span className="block text-xs text-muted">Dùng "Link chính" trong Mục tiêu & DNA → Lời kêu gọi. Mặc định tắt.</span></span></label>
          <Field label="Câu bình luận mặc định — Facebook" hint="Dùng {link}, {san_pham}, {shop}. Câu riêng của từng sản phẩm (ở DNA) được ưu tiên.">
            <input className={inputCls} defaultValue={s.facebook} placeholder="Link {san_pham} & ưu đãi: {link}" onBlur={(e) => e.target.value !== s.facebook && save({ facebook: e.target.value })} />
          </Field>
          <Field label="Câu bình luận mặc định — Instagram" hint="Link trong bình luận Instagram không bấm được; câu mặc định hướng về link ở bio.">
            <input className={inputCls} defaultValue={s.instagram} placeholder="Link sản phẩm ở bio của {shop} 👆" onBlur={(e) => e.target.value !== s.instagram && save({ instagram: e.target.value })} />
          </Field>
        </div>
      )}
    </Card>
  );
}
