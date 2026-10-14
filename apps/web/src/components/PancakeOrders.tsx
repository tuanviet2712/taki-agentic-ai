import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Link2, RefreshCw, Search, Send, Unlink, X } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo, vnd } from "../lib/format";
import { Badge, Button, Empty, Field, Loading, Modal, Toggle, cx, inputCls, useToast } from "./ui";

/**
 * Đơn hàng ↔ Pancake POS (packages/orchestrator/src/order-push.ts phía máy chủ):
 *  - OrderDraftPanel: phiếu lên đơn khi Sếp duyệt đơn nháp do bot chốt (giao hàng, số lượng, giá, COD, bật/tắt đẩy Pancake).
 *  - PancakeChip + RepushModal: trạng thái đơn trên Pancake, link mở đơn, nút "Đẩy sang Pancake / Đẩy lại".
 *  - ConversationOrders: khối "Đơn hàng" trong trang Chat (kèm đổi trạng thái tay cho đơn chưa lên Pancake).
 *  - PancakeMapPanel: ghép sản phẩm DNA ↔ mẫu mã Pancake (trang Mục tiêu & DNA, Trung tâm tích hợp) + đơn đã duyệt gần đây.
 * Không có menu riêng; không đơn nào tới Pancake nếu Sếp không bật "Đẩy sang Pancake" trong phiếu.
 */

type FormState = {
  fullName: string; phone: string; address: string; quantity: string; unitPrice: string; discount: string; shippingFee: string; cod: string; note: string; push: boolean;
};
const toInt = (s: string) => {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const totalOf = (f: FormState) => Math.max(0, toInt(f.quantity || "1") * toInt(f.unitPrice) - toInt(f.discount) + toInt(f.shippingFee));
function toPayload(f: FormState, opts: { keepPhoneIfEmpty?: boolean } = {}) {
  return {
    fullName: f.fullName.trim(),
    ...(f.phone.trim() || !opts.keepPhoneIfEmpty ? { phone: f.phone.trim() } : {}),
    address: f.address.trim() || undefined,
    quantity: Math.max(1, toInt(f.quantity || "1")),
    unitPrice: toInt(f.unitPrice),
    discount: toInt(f.discount),
    shippingFee: toInt(f.shippingFee),
    ...(f.cod.trim() ? { cod: toInt(f.cod) } : {}),
    note: f.note.trim() || undefined,
    pushToPancake: f.push,
  };
}

/** Các ô của phiếu lên đơn (dùng chung cho duyệt đơn nháp và "Đẩy sang Pancake"). */
function OrderFields({ f, set, needsShipping, phoneHint }: { f: FormState; set: (p: Partial<FormState>) => void; needsShipping: boolean; phoneHint?: string }) {
  const money = (k: keyof FormState, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input className={inputCls} inputMode="numeric" value={f[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<FormState>)} /></Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Tên người nhận"><input className={inputCls} value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
      <Field label="Số điện thoại" hint={phoneHint}><input className={inputCls} inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder={phoneHint ? "Để trống = giữ số cũ" : "09…"} /></Field>
      {needsShipping ? (
        <div className="sm:col-span-2">
          <Field label="Địa chỉ nhận hàng" hint="Ghi đủ số nhà, đường, phường/xã, quận/huyện, tỉnh/thành — Pancake tự nhận tỉnh/huyện/xã từ địa chỉ này.">
            <textarea className={cx(inputCls, "min-h-16")} value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="Ví dụ: 12 Lê Lợi, Phường Bến Nghé, Quận 1, TP Hồ Chí Minh" />
          </Field>
        </div>
      ) : <p className="rounded-xl bg-soft px-3 py-2 text-xs text-muted sm:col-span-2">Khoá học / dịch vụ / phần mềm: không cần địa chỉ giao hàng.</p>}
      {money("quantity", "Số lượng")}
      {money("unitPrice", "Đơn giá (đ)")}
      {money("discount", "Giảm giá (đ)")}
      {money("shippingFee", "Phí ship khách trả (đ)")}
      {money("cod", "Tiền thu hộ COD (đ)", `Để trống = bằng tổng đơn (${vnd(totalOf(f))})`)}
      <Field label="Ghi chú đơn"><input className={inputCls} value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="Ví dụ: giao giờ hành chính" /></Field>
    </div>
  );
}

// ------------------------------- Duyệt đơn nháp -------------------------------
export function OrderDraftPanel({ approval, onDone }: { approval: any; onDone: (decision: "approve" | "reject") => void }) {
  const ctx = useApi<any>(`orders/draft/${approval.id}`);
  const [f, setF] = useState<FormState | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const c = ctx.data;

  useEffect(() => {
    if (!c) return;
    setF({
      fullName: c.defaults.fullName ?? "", phone: c.defaults.phone ?? "", address: "", quantity: "1", unitPrice: String(c.defaults.unitPrice ?? 0),
      discount: "0", shippingFee: "0", cod: "", note: "", push: Boolean(c.pushDefault),
    });
  }, [c]);
  if (ctx.error) return <p className="text-sm text-rose-600">{ctx.error}</p>;
  if (!c || !f) return <Loading />;
  const set = (p: Partial<FormState>) => setF({ ...f, ...p });
  const ship = c.product.needsShipping;
  const missing = !f.fullName.trim() ? "Nhập tên người nhận" : f.push && !f.phone.trim() ? "Nhập số điện thoại" : f.push && ship && !f.address.trim() ? "Nhập địa chỉ nhận hàng" : null;

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await api.post(`approvals/${approval.id}/decide`, decision === "approve" ? { decision, orderForm: toPayload(f) } : { decision, note });
      toast(decision === "approve" ? (f.push ? "Đã lên đơn — đang đẩy sang Pancake" : "Đã lên đơn (không đẩy Pancake)") : "Đã từ chối đơn nháp");
      onDone(decision);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet">{c.product.name}</Badge>
        <Badge tone={ship ? "blue" : "gray"}>{ship ? "Hàng cần giao" : "Không cần giao hàng"}</Badge>
        {approval.preview?.phoneMasked && <span className="text-xs text-muted">SĐT khách: {approval.preview.phoneMasked}</span>}
        {approval.preview?.conversationId && <a href={`/chat?id=${approval.preview.conversationId}`} className="text-xs text-blue-600 underline">Mở hội thoại</a>}
      </div>
      <OrderFields f={f} set={set} needsShipping={ship} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-soft/60 p-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">Tổng đơn: {vnd(totalOf(f))}</p>
          <p className="text-xs text-muted">Thu hộ COD: {vnd(f.cod.trim() ? toInt(f.cod) : totalOf(f))}</p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium">Đẩy sang Pancake</span>
          <Toggle checked={f.push} onChange={(v) => set({ push: v })} />
        </label>
      </div>
      {f.push && c.blockReason && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          {c.blockReason} {c.blockLink && <Link to={c.blockLink} className="font-semibold underline">Mở</Link>}
          <br />Đơn vẫn được lưu; khi xử lý xong, bấm "Đẩy lại" ở đơn.
        </p>
      )}
      {f.push && !c.blockReason && <p className="text-xs text-muted">Sẽ tạo đơn thật trên Pancake POS{c.pancake.shopName ? ` (shop ${c.pancake.shopName})` : ""} với mẫu mã: <b className="text-ink">{c.pancake.variationName}</b>.</p>}
      {!f.push && <p className="text-xs text-muted">Không bật "Đẩy sang Pancake": đơn chỉ được lưu trong hệ thống (sau này có thể bấm "Đẩy sang Pancake" ở đơn).</p>}
      <div className="space-y-2 border-t border-line pt-4">
        {rejecting && <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do từ chối (bắt buộc) — ví dụ: khách đã huỷ" />}
        <div className="flex flex-wrap justify-end gap-2">
          {rejecting ? (
            <>
              <Button variant="ghost" onClick={() => setRejecting(false)}>Hủy</Button>
              <Button variant="danger" loading={busy} disabled={!note.trim()} onClick={() => decide("reject")}>Xác nhận từ chối</Button>
            </>
          ) : (
            <>
              <Button variant="danger" icon={X} onClick={() => setRejecting(true)}>Từ chối</Button>
              <Button variant="success" icon={Check} loading={busy} disabled={!!missing} onClick={() => decide("approve")}>{f.push ? "Duyệt & đẩy sang Pancake" : "Duyệt đơn"}</Button>
            </>
          )}
        </div>
        {missing && !rejecting && <p className="text-right text-xs text-amber-600">{missing}</p>}
        <p className="text-right text-xs text-muted">Đơn chỉ thành đơn thật khi Sếp bấm duyệt (cổng đỏ).</p>
      </div>
    </div>
  );
}

// ------------------------------- Trạng thái Pancake của 1 đơn -------------------------------
const STATE: Record<string, { label: string; tone: any }> = {
  off: { label: "Chưa đẩy Pancake", tone: "gray" }, queued: { label: "Đang chờ đẩy Pancake", tone: "violet" }, pushing: { label: "Đang đẩy Pancake…", tone: "violet" },
  blocked: { label: "Chưa đẩy được", tone: "amber" }, failed: { label: "Lỗi đẩy Pancake", tone: "red" },
};
export function PancakeChip({ order, onChanged }: { order: any; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const pk = order.meta?.pancake;
  if (!pk) return null;
  const pushed = pk.state === "pushed";
  const st = pushed ? { label: `Pancake: ${pk.status ?? "đã tạo"}`, tone: pk.statusCode === 6 || pk.statusCode === 7 ? "red" : pk.statusCode === 3 || pk.statusCode === 16 ? "green" : "violet" } : STATE[pk.state] ?? { label: pk.state, tone: "gray" };
  // Chỉ đơn đã qua cổng duyệt mới đẩy được (máy chủ cũng kiểm).
  const canRepush = Boolean(order.meta?.approvalId) && (pk.state === "failed" || pk.state === "blocked" || pk.state === "off");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={st.tone}>{st.label}</Badge>
        {pushed && pk.displayId && <span className="text-xs text-muted">#{pk.displayId}</span>}
        {pk.url && <a href={pk.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-blue-600 underline">Mở trên Pancake<ExternalLink className="h-3 w-3" /></a>}
        {canRepush && <Button size="sm" variant="soft" icon={Send} onClick={() => setOpen(true)}>{pk.state === "off" ? "Đẩy sang Pancake" : "Đẩy lại"}</Button>}
      </div>
      {(pk.reason || pk.error) && !pushed && (
        <p className="text-xs text-amber-700 dark:text-amber-300">{pk.reason ?? pk.error} {pk.link && <Link to={pk.link} className="font-semibold underline">Mở</Link>}</p>
      )}
      {open && <RepushModal order={order} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged?.(); }} />}
    </div>
  );
}

function RepushModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const s = order.meta?.shipping ?? {};
  const [f, setF] = useState<FormState>({
    fullName: s.fullName ?? order.customer_name ?? "", phone: "", address: s.address ?? "", quantity: String(s.quantity ?? 1), unitPrice: String(s.unitPrice ?? order.total ?? 0),
    discount: String(s.discount ?? 0), shippingFee: String(s.shippingFee ?? 0), cod: s.cod != null ? String(s.cod) : "", note: s.note ?? "", push: true,
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ship = s.needsShipping !== false;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`orders/${order.id}/push-pancake`, { orderForm: toPayload({ ...f, push: true }, { keepPhoneIfEmpty: true }) });
      toast("Đã xếp lượt đẩy sang Pancake");
      onDone();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} wide title={`Đẩy đơn sang Pancake — ${order.product}`}
      footer={<><Button variant="ghost" onClick={onClose}>Đóng</Button><Button variant="primary" icon={Send} loading={busy} disabled={!f.fullName.trim() || (ship && !f.address.trim())} onClick={submit}>Đẩy sang Pancake</Button></>}>
      <OrderFields f={f} set={(p) => setF({ ...f, ...p })} needsShipping={ship} phoneHint={s.phoneMasked ? `Đang lưu: ${s.phoneMasked}` : undefined} />
    </Modal>
  );
}

// ------------------------------- Khối "Đơn hàng" trong Chat -------------------------------
const ORDER_STATUS_VI: Record<string, string> = { pending: "đang xử lý", paid: "đã thanh toán", cancelled: "đã huỷ", returned: "hoàn hàng" };
export function ConversationOrders({ conversationId }: { conversationId: string }) {
  const list = useApi<any[]>(`orders/by-conversation/${conversationId}`, ["order.", "approval.decided"]);
  const toast = useToast();
  if (!list.data?.length) return null;
  const setStatus = async (id: string, status: string) => {
    try { await api.post(`orders/${id}/status`, { status }); list.reload(); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="mt-3 text-xs">
      <p className="mb-1 font-semibold">Đơn hàng</p>
      <div className="space-y-2">
        {list.data.map((o) => (
          <div key={o.id} className="rounded-xl border border-line p-2">
            <p>{o.product} · {vnd(o.total)} · {ORDER_STATUS_VI[o.status] ?? o.status}</p>
            <div className="mt-1"><PancakeChip order={o} onChanged={list.reload} /></div>
            {!o.meta?.pancake?.orderId && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-muted">Đổi trạng thái:</span>
                {(["paid", "cancelled", "returned"] as const).filter((s) => s !== o.status).map((s) => (
                  <Button key={s} size="sm" variant="ghost" onClick={() => setStatus(o.id, s)}>{s === "paid" ? "Đã thanh toán" : s === "cancelled" ? "Huỷ" : "Hoàn hàng"}</Button>
                ))}
                {o.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => setStatus(o.id, "pending")}>Đang xử lý</Button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------- Ghép sản phẩm Pancake (trang DNA / Tích hợp) -------------------------------
export function PancakeMapPanel({ defaultOpen, showOrders = true, onChanged }: { defaultOpen?: boolean; showOrders?: boolean; onChanged?: () => void }) {
  const ov = useApi<any>("pancake/overview", ["order.", "approval.decided", "metrics.updated"]);
  const [picking, setPicking] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const toast = useToast();
  const d = ov.data;
  if (d && !d.connection) {
    return <p className="mt-3 rounded-xl border border-dashed border-line p-3 text-xs text-muted" id="pancake-map">Kết nối Pancake POS ở <Link to="/ads/integrations" className="font-semibold text-blue-600 underline">Trung tâm tích hợp</Link> để ghép sản phẩm với mẫu mã và đẩy đơn đã duyệt.</p>;
  }
  const unmapped = d?.products?.filter((p: any) => !p.mapping).length ?? 0;
  const usable = d?.connection?.usable;
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post("orders/pancake-sync");
      toast(r.checked ? `Đã kiểm ${r.checked} đơn, cập nhật ${r.updated}` : "Chưa có đơn nào cần cập nhật");
      ov.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setSyncing(false); }
  };
  const unmap = async (key: string) => {
    try { await api.del(`pancake/products/${encodeURIComponent(key)}`); ov.reload(); onChanged?.(); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-sm" id="pancake-map">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="font-semibold text-ink">Ghép sản phẩm Pancake</span>
        <span className="flex items-center gap-2">{d && (unmapped ? <Badge tone="amber">{unmapped} chưa ghép</Badge> : <Badge tone="green">Đã ghép đủ</Badge>)}<span className="text-xs text-blue-600">{open ? "Thu gọn" : "Mở"}</span></span>
      </button>
      {open && (!d ? <Loading /> : (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted">
            Mỗi sản phẩm trong DNA cần ghép với 1 mẫu mã trên Pancake để đơn Sếp duyệt (và bật "Đẩy sang Pancake") được tạo thẳng trên Pancake
            {d.connection.shopName ? <> · shop <b className="text-ink">{d.connection.shopName}</b></> : null}.
          </p>
          {!usable && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              {d.connection.state === "sandbox" ? "Kết nối Pancake đang ở chế độ mô phỏng — nhập API key thật ở Trung tâm tích hợp." : "Kết nối Pancake đã hết hạn hoặc lỗi — kiểm tra lại API key."}{" "}
              <Link to="/ads/integrations" className="font-semibold underline">Mở</Link>
            </p>
          )}
          {!d.products.length ? <Empty>Chưa có sản phẩm trong DNA.</Empty> : (
            <ul className="divide-y divide-line">
              {d.products.map((p: any) => (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{p.name} {p.price != null && <span className="text-xs text-muted">· {vnd(p.price)}</span>}</p>
                    {p.mapping ? (
                      <p className={cx("truncate text-xs", p.mapping.shopMismatch ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>
                        ↔ {p.mapping.variationName ?? p.mapping.variationId}{p.mapping.price != null ? ` · ${vnd(p.mapping.price)}` : ""}{p.mapping.shopMismatch ? " · ghép với shop khác — ghép lại" : ""}
                      </p>
                    ) : <p className="text-xs text-amber-700 dark:text-amber-300">Chưa ghép</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant={p.mapping ? "secondary" : "primary"} icon={Link2} disabled={!usable} onClick={() => setPicking(p)}>{p.mapping ? "Đổi" : "Ghép"}</Button>
                    {p.mapping && <Button size="sm" variant="ghost" icon={Unlink} onClick={() => unmap(p.key)} aria-label="Bỏ ghép" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showOrders && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-semibold text-ink">Đơn đã duyệt gần đây</p>
                <Button size="sm" icon={RefreshCw} loading={syncing} disabled={!usable} onClick={sync}>Cập nhật trạng thái</Button>
              </div>
              {!d.recent.length ? <p className="text-xs text-muted">Chưa có đơn nào.</p> : (
                <ul className="space-y-2">
                  {d.recent.map((o: any) => (
                    <li key={o.id} className="rounded-xl border border-line bg-card p-2 text-xs">
                      <p className="text-ink">{o.customer_name} · {o.product} · {vnd(o.total)} <span className="text-muted">· {timeAgo(o.created_at)}</span></p>
                      <div className="mt-1"><PancakeChip order={o} onChanged={ov.reload} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ))}
      {picking && <VariationPicker product={picking} onClose={() => setPicking(null)} onDone={() => { setPicking(null); ov.reload(); onChanged?.(); }} />}
    </div>
  );
}

function VariationPicker({ product, onClose, onDone }: { product: any; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState(product.name ?? "");
  const [items, setItems] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const find = async () => {
    setBusy(true);
    try {
      const r = await api.get(`pancake/variations?search=${encodeURIComponent(search)}`);
      setItems(r.items);
    } catch (e: any) { toast(e.message, "err"); setItems([]); } finally { setBusy(false); }
  };
  useEffect(() => { void find(); }, []); // tìm theo tên sản phẩm ngay khi mở
  const pick = async (v: any) => {
    try {
      await api.put(`pancake/products/${encodeURIComponent(product.key)}`, { variationId: v.id, productId: v.productId, variationName: v.name, price: v.price });
      toast(`Đã ghép "${product.name}" với "${v.name}"`);
      onDone();
    } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <Modal open onClose={onClose} wide title={`Ghép "${product.name}" với mẫu mã Pancake`}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên sản phẩm hoặc mã trên Pancake" />
        <Button variant="primary" icon={Search} loading={busy} type="submit">Tìm</Button>
      </form>
      <div className="mt-3 max-h-80 overflow-auto scroll-thin">
        {items == null ? <Loading /> : !items.length ? <Empty>Không thấy mẫu mã nào — thử tên ngắn hơn.</Empty> : (
          <ul className="divide-y divide-line">
            {items.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-ink">{v.name}</p>
                  <p className="text-xs text-muted">{v.sku ? `Mã ${v.sku} · ` : ""}{v.price != null ? vnd(v.price) : "chưa có giá"}{v.stock != null ? ` · còn ${v.stock}` : ""}</p>
                </div>
                <Button size="sm" variant="primary" onClick={() => pick(v)}>Chọn</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
