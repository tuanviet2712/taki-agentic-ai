import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { api, switchBiz, useApi } from "../lib/api";
import { Button, Field, Modal, cx, inputCls, useToast } from "./ui";

type Biz = { id: string; name: string; isDefault: boolean; counts: { goals: number; posts: number; conversations: number; approvals: number } };

/** Bộ chọn doanh nghiệp trên thanh đầu trang ("TAKI Group ▾"): đổi biz, thêm doanh nghiệp, đổi tên. */
export function BusinessSwitcher() {
  const { data, reload } = useApi<{ current: string; items: Biz[]; archived?: { id: string; name: string; archivedAt: string | null }[] }>("businesses");
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "add" | "rename" | "archive">(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const items = data?.items ?? [];
  const current = items.find((b) => b.id === data?.current);

  const archive = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.del<{ current: string }>(`businesses/${current.id}?confirm=1`);
      toast(`Đã lưu trữ "${current.name}" — dữ liệu vẫn giữ nguyên, khôi phục được bất cứ lúc nào`, "ok");
      switchBiz(r.current);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
      setBusy(false);
    }
  };
  const restore = async (id: string, label: string) => {
    try {
      await api.post(`businesses/${id}/restore`);
      toast(`Đã khôi phục "${label}"`, "ok");
      switchBiz(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const submit = async () => {
    if (modal === "archive") return archive();
    const n = name.trim();
    if (n.length < 2) return toast("Tên doanh nghiệp cần ít nhất 2 ký tự", "err");
    setBusy(true);
    try {
      if (modal === "add") {
        const b = await api.post<{ id: string }>("businesses", { name: n });
        toast(`Đã tạo "${n}" — chuyển sang để thiết lập`, "ok");
        switchBiz(b.id, "/dna?import=1"); // doanh nghiệp mới bắt đầu ở Mục tiêu & DNA → Nạp DNA (tài liệu hoặc link website)
        return;
      }
      if (current) await api.put(`businesses/${current.id}`, { name: n });
      toast("Đã đổi tên doanh nghiệp", "ok");
      setModal(null);
      reload();
      window.location.reload(); // tên hiển thị ở nhiều chỗ (thanh bên, tổng quan)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} className="flex w-full max-w-[110px] items-center gap-1 rounded-xl border border-line px-2 py-1.5 sm:max-w-[220px] sm:gap-2 sm:px-3 text-sm font-medium text-ink transition hover:bg-soft" aria-haspopup="menu" aria-expanded={open} title="Đổi doanh nghiệp">
        <span aria-hidden className="hidden sm:inline">🏢</span>
        <span className="truncate">{current?.name ?? "Doanh nghiệp"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-11 z-30 w-72 rounded-2xl border border-line bg-card p-2 shadow-xl">
          <p className="px-2 py-1 text-sm font-semibold">Doanh nghiệp</p>
          <div className="max-h-72 overflow-y-auto scroll-thin">
            {items.map((b) => (
              <button key={b.id} role="menuitem" onClick={() => (b.id === current?.id ? setOpen(false) : switchBiz(b.id))}
                className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-soft", b.id === current?.id && "font-semibold text-blue-700 dark:text-blue-300")}>
                <span className="w-4">{b.id === current?.id && <Check className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{b.name}</span>
                  <span className="block text-xs font-normal text-muted">{b.counts.goals} chiến dịch · {b.counts.posts} bài · {b.counts.conversations} hội thoại</span>
                </span>
                {b.counts.approvals > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{b.counts.approvals}</span>}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button role="menuitem" onClick={() => { setName(""); setModal("add"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-soft"><Plus className="h-4 w-4" />Thêm doanh nghiệp</button>
            <button role="menuitem" onClick={() => { setName(current?.name ?? ""); setModal("rename"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-soft"><Pencil className="h-4 w-4" />Đổi tên</button>
            {items.length > 1 && (
              <button role="menuitem" onClick={() => { setModal("archive"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted hover:bg-soft hover:text-ink"><Archive className="h-4 w-4" />Lưu trữ doanh nghiệp này</button>
            )}
          </div>
          {(data.archived ?? []).length > 0 && (
            <div className="mt-1 border-t border-line pt-1">
              <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">Đã lưu trữ</p>
              {data.archived!.map((b) => (
                <div key={b.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-muted">{b.name}</span>
                  <button onClick={() => restore(b.id, b.name)} className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"><ArchiveRestore className="h-3.5 w-3.5" />Khôi phục</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "add" ? "Thêm doanh nghiệp" : modal === "archive" ? "Lưu trữ doanh nghiệp?" : "Đổi tên doanh nghiệp"}
        footer={<><Button onClick={() => setModal(null)}>Huỷ</Button><Button variant={modal === "archive" ? "danger" : "primary"} loading={busy} onClick={submit}>{modal === "add" ? "Tạo & thiết lập" : modal === "archive" ? "Lưu trữ" : "Lưu"}</Button></>}>
        {modal === "archive" ? (
          <p className="text-sm text-muted"><b className="text-ink">{current?.name}</b> sẽ ẩn khỏi danh sách và <b className="text-ink">dừng mọi việc chạy nền</b> (đăng bài, nhắn khách, nhắc việc). Dữ liệu giữ nguyên — khôi phục bất cứ lúc nào ở mục "Đã lưu trữ" trong menu này.</p>
        ) : (
          <>
            {modal === "add" && <p className="mb-4 text-sm text-muted">Mỗi doanh nghiệp có DNA, sản phẩm, kênh đăng, khách và báo cáo riêng. Doanh nghiệp mới bắt đầu TRỐNG (không đụng dữ liệu doanh nghiệp khác); sau khi tạo, hệ thống mở Mục tiêu & DNA → Nạp DNA để AI đọc tài liệu hoặc website và điền giúp.</p>}
            <Field label="Tên doanh nghiệp">
              <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="VD: Học viện Kinh doanh An Nhiên" maxLength={120} />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}
