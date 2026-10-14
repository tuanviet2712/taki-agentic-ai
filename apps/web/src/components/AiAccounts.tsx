import { useEffect, useState } from "react";
import { LogIn, Plus, RefreshCw, Trash2, Unplug, X } from "lucide-react";
import { api, useApi } from "../lib/api";
import { Badge, Button, Loading, Modal, inputCls, useToast } from "./ui";

type Account = { id: string; name: string; email?: string; plan?: string; loggedIn: boolean; running: number;
  login?: { state: string; method: string; url?: string; code?: string; error?: string; expiresAt: string } | null };

export function AiAccounts({ selectedId, available, onSelect, onChange }: { selectedId?: string | null; available: boolean; onSelect: (id: string) => Promise<void>; onChange: () => void }) {
  const { data: accounts, reload, error } = useApi<Account[]>("llm/accounts", ["llm."]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ account: Account; remove: boolean } | null>(null);
  const toast = useToast();
  const waiting = accounts?.some((a) => a.login?.state === "waiting");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(reload, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, reload]);
  const action = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); reload(); onChange(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(null); }
  };
  const login = (a: Account, method: string) => action(`${a.id}-login`, () => api.post(`llm/accounts/${a.id}/login`, { method }));
  return <div className="space-y-3 rounded-xl border border-line p-4">
    <div><h3 className="font-semibold text-ink">Tài khoản ChatGPT</h3><p className="mt-1 text-xs text-muted">Thêm hồ sơ riêng cho từng người hoặc doanh nghiệp, đăng nhập rồi chọn hồ sơ dùng cho đội AI. Mỗi hồ sơ lưu phiên riêng trên máy chạy hệ thống.</p></div>
    {!available && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Máy này chưa có Codex CLI. Cài bằng <code>npm install -g @openai/codex</code> rồi bấm làm mới.</p>}
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void action("create", async () => { await api.post("llm/accounts", { name: name.trim() }); setName(""); }); }}>
      <input className={`${inputCls} min-w-48 flex-1`} aria-label="Tên hồ sơ ChatGPT" placeholder="Tên hồ sơ, ví dụ: Cá nhân / Công ty" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <Button icon={Plus} type="submit" disabled={!name.trim() || !!busy} loading={busy === "create"}>Thêm hồ sơ</Button>
      <Button type="button" icon={RefreshCw} onClick={() => { reload(); onChange(); }} title="Làm mới hồ sơ">Làm mới</Button>
    </form>
    {error ? <p className="text-sm text-rose-600">{error}</p> : !accounts ? <Loading /> : !accounts.length ? <p className="text-sm text-muted">Chưa có hồ sơ ChatGPT. Thêm hồ sơ và tự đăng nhập tài khoản bạn muốn dùng.</p> : <div className="space-y-3">
      {accounts.map((a) => <div key={a.id} className="space-y-3 rounded-xl bg-soft p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{a.name}</span><Badge tone={a.loggedIn ? "green" : "gray"}>{a.loggedIn ? "Đã đăng nhập" : "Chưa đăng nhập"}</Badge>{selectedId === a.id && <Badge tone="blue">Đang chọn</Badge>}{a.running > 0 && <Badge tone="amber">{a.running} tác vụ đang chạy</Badge>}</div>
        {a.email && <p className="break-all text-xs text-muted">{a.email}{a.plan ? ` · ${a.plan}` : ""}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!a.loggedIn || !!busy || a.login?.state === "waiting"} onClick={() => action(`${a.id}-select`, () => onSelect(a.id))}>{selectedId === a.id ? "Dùng lại hồ sơ này" : "Dùng hồ sơ này"}</Button>
          <Button size="sm" icon={LogIn} disabled={!available || !!busy || !!waiting || !!a.running} loading={busy === `${a.id}-login`} onClick={() => login(a, "browser")}>{a.loggedIn ? "Đổi tài khoản" : "Đăng nhập ChatGPT"}</Button>
          <Button size="sm" disabled={!available || !!busy || !!waiting || !!a.running} onClick={() => login(a, "device")}>Đăng nhập bằng mã</Button>
          <Button size="sm" icon={RefreshCw} disabled={!!busy} onClick={() => action(`${a.id}-check`, async () => { const r = await api.post(`llm/accounts/${a.id}/check`); toast(r.loggedIn ? "CLI đã nhận phiên đăng nhập. Bấm Thử model để kiểm tra khả năng trả lời." : "Chưa xác nhận được phiên đăng nhập", r.loggedIn ? "ok" : "err"); })}>Kiểm tra phiên</Button>
          {a.loggedIn && <Button size="sm" icon={Unplug} disabled={!!busy || !!a.running} onClick={() => setConfirm({ account: a, remove: false })}>Ngắt kết nối</Button>}
          <Button size="sm" icon={Trash2} disabled={!!busy || !!a.running} onClick={() => setConfirm({ account: a, remove: true })}>Xóa hồ sơ</Button>
        </div>
        {a.login?.state === "waiting" && <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
          <p>Đang chờ bạn đăng nhập tài khoản ChatGPT muốn dùng cho <b>{a.name}</b>.</p>
          {a.login.url ? <a className="inline-block font-medium text-blue-600 underline" href={a.login.url} target="_blank" rel="noopener noreferrer">Mở trang đăng nhập OpenAI</a> : <p className="text-xs text-muted">Đang lấy liên kết đăng nhập…</p>}
          {a.login.code && <p>Mã thiết bị: <code className="rounded bg-card px-2 py-1 font-semibold">{a.login.code}</code></p>}
          <p className="text-xs text-muted">Nếu trình duyệt đang đăng nhập tài khoản khác, chọn đổi tài khoản trên trang OpenAI. Hoàn tất rồi bấm Dùng hồ sơ này.</p>
          <Button size="sm" icon={X} onClick={() => action(`${a.id}-cancel`, () => api.post(`llm/accounts/${a.id}/cancel`))}>Hủy đăng nhập</Button>
        </div>}
        {a.login?.state === "done" && <p className="text-xs text-emerald-600">Đăng nhập hoàn tất. Chọn Dùng hồ sơ này để kết nối với các agent.</p>}
        {a.login?.error && <p className="text-xs text-rose-600">{a.login.error}</p>}
      </div>)}
    </div>}
    <p className="text-xs text-muted">Các lượt gọi dùng hạn mức Codex của tài khoản ChatGPT đã chọn. Tài khoản cần có quyền dùng Codex. <a className="text-blue-600 underline" href="https://learn.chatgpt.com/docs/auth" target="_blank" rel="noopener noreferrer">Hướng dẫn đăng nhập OpenAI</a></p>
    <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.remove ? "Xóa hồ sơ ChatGPT" : "Ngắt kết nối ChatGPT"}
      footer={<><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="danger" loading={!!busy} onClick={() => { if (confirm) void action("disconnect", async () => { if (confirm.remove) await api.del(`llm/accounts/${confirm.account.id}`); else await api.post(`llm/accounts/${confirm.account.id}/disconnect`); setConfirm(null); }); }}>Xác nhận</Button></>}>
      <p className="text-sm">Đăng xuất hồ sơ <b>{confirm?.account.name}</b> khỏi hệ thống. Bạn có thể đăng nhập lại khi cần.</p>
    </Modal>
  </div>;
}
