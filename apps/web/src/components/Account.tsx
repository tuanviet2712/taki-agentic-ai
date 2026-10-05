import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ChevronDown, LogOut, Settings2, Trash2, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, apiUrl, useApi } from "../lib/api";
import { Avatar, Button, Field, Loading, Modal, inputCls, useToast } from "./ui";

export type Profile = { name: string; title: string; email: string; phone: string; addressAs: string; avatar: string | null };
/** Hồ sơ gọn kèm trong GET /v1/system (không chứa ảnh — ảnh lấy ở /v1/account/avatar). */
export type SysProfile = { name?: string; title?: string; addressAs?: string; hasAvatar?: boolean; avatarVersion?: string | number | null; avatar?: string | null };
const FIELDS: (keyof Profile)[] = ["name", "title", "email", "phone", "addressAs", "avatar"];
/** Báo cho đầu trang / tổng quan / form khác biết hồ sơ vừa đổi. */
export const PROFILE_EVENT = "taki:profile";

/** Thu ảnh về 256×256 (cắt giữa) → JPEG nhỏ để lưu kèm hồ sơ. */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("Không đọc được ảnh")); i.src = url; });
    const S = 256, side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = S;
    c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/** Form "Tài khoản của tôi" — dùng ở Cài đặt và ở menu ảnh đại diện trên đầu trang. */
export function AccountForm({ onSaved, compact }: { onSaved?: (p: Profile) => void; compact?: boolean }) {
  const toast = useToast();
  const { data, reload } = useApi<Profile>("account");
  const [f, setF] = useState<Profile | null>(null);
  const [orig, setOrig] = useState<Profile | null>(null); // bản trên máy chủ lúc nạp form — để biết ô nào đã sửa
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = f && orig ? FIELDS.filter((k) => (f[k] ?? null) !== (orig[k] ?? null)) : [];
  const dirty = changed.length > 0;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // Nạp lại form khi hồ sơ đổi ở chỗ khác (menu ảnh đại diện…) — chỉ khi Sếp chưa sửa dở gì ở đây.
  useEffect(() => {
    if (!data) return;
    if (!dirtyRef.current) setF(data);
    setOrig(data);
  }, [data]);
  useEffect(() => {
    const r = () => void reload();
    window.addEventListener(PROFILE_EVENT, r);
    return () => window.removeEventListener(PROFILE_EVENT, r);
  }, [reload]);
  if (!f) return <Loading />;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF({ ...f, [k]: v });

  const pick = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Chọn ảnh PNG, JPG hoặc WebP", "err");
    try { set("avatar", await shrinkImage(file)); } catch (e: any) { toast(e.message, "err"); }
  };
  const save = async () => {
    if (!dirty) { toast("Chưa có thay đổi nào", "info"); return; }
    setSaving(true);
    try {
      // Chỉ gửi ô đã sửa → không ghi đè ảnh/thông tin vừa đổi ở chỗ khác.
      const p = await api.put<Profile>("account", Object.fromEntries(changed.map((k) => [k, f[k]])));
      dirtyRef.current = false;
      setF(p);
      setOrig(p);
      toast("Đã lưu thông tin tài khoản");
      window.dispatchEvent(new Event(PROFILE_EVENT));
      onSaved?.(p);
    } catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar name={f.name || f.addressAs || "?"} src={f.avatar} size={compact ? 64 : 72} />
          <button type="button" onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-line bg-card text-muted shadow hover:text-ink" aria-label="Đổi ảnh đại diện" title="Đổi ảnh đại diện"><Camera className="h-3.5 w-3.5" /></button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">{f.name || "Chưa đặt tên"}</p>
          <p className="text-muted">{f.title || "—"}</p>
          {f.avatar && <button type="button" onClick={() => set("avatar", null)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-rose-600"><Trash2 className="h-3 w-3" />Bỏ ảnh</button>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Họ tên hiển thị"><input className={inputCls} value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="VD: Nguyễn Văn A" /></Field>
        <Field label="Chức danh"><input className={inputCls} value={f.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="VD: CEO, Trưởng phòng Marketing" /></Field>
        <Field label="Email"><input type="email" className={inputCls} value={f.email} maxLength={120} onChange={(e) => set("email", e.target.value)} placeholder="ban@congty.vn" /></Field>
        <Field label="Số điện thoại"><input className={inputCls} value={f.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} placeholder="09xx xxx xxx" /></Field>
        <Field label="Trợ lý gọi bạn là" hint={`Trợ lý xưng "em" và gọi bạn là "${f.addressAs || "Sếp"}".`}>
          <input className={inputCls} value={f.addressAs} maxLength={30} onChange={(e) => set("addressAs", e.target.value)} placeholder="Sếp" />
        </Field>
      </div>
      <p className="text-xs text-muted">Thông tin này dùng chung cho mọi doanh nghiệp bạn quản lý. Email/SĐT chỉ lưu trên máy, không gửi cho AI.</p>
      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Chưa lưu</span>}
        <Button variant="primary" loading={saving} onClick={save}>Lưu thông tin</Button>
      </div>
    </div>
  );
}

/** Ảnh đại diện + tên trên đầu trang; bấm vào để sửa tài khoản / đăng xuất. */
export function AccountMenu({ profile: p, canLogout, onLogout, extra }: { profile?: SysProfile | null; canLogout: boolean; onLogout: () => void; /** Mục thêm trong menu (vd đổi sáng/tối, cài app trên điện thoại) */ extra?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [imgFailed, setImgFailed] = useState<string | null>(null);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  // Ảnh lấy qua đường riêng (không nhét base64 vào /v1/system); máy chủ cũ còn gửi kèm avatar thì dùng luôn.
  const rawSrc = p?.hasAvatar ? apiUrl(`account/avatar?v=${encodeURIComponent(String(p.avatarVersion ?? ""))}`) : p?.avatar ?? null;
  const src = rawSrc && rawSrc !== imgFailed ? rawSrc : null;
  const onImgError = () => setImgFailed(rawSrc); // 404/lỗi → về chữ cái đầu
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const name = p?.name || "Tài khoản";

  return (
    <div ref={box} className="relative shrink-0">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl p-0.5 hover:bg-soft sm:px-1.5 sm:py-1" aria-haspopup="menu" aria-expanded={open} title="Tài khoản của tôi">
        <Avatar name={name} src={src} size={34} onError={onImgError} />
        <span className="hidden text-left text-sm leading-tight xl:block"><span className="block max-w-[160px] truncate font-semibold">{name}</span><span className="block max-w-[160px] truncate text-xs text-muted">{p?.title || "Chủ doanh nghiệp"}</span></span>
        <ChevronDown className="hidden h-4 w-4 text-muted xl:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-line bg-card p-2 shadow-xl">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={name} src={src} size={40} onError={onImgError} />
            <div className="min-w-0 text-sm"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-muted">{p?.title || "Chủ doanh nghiệp"}</p></div>
          </div>
          <div className="my-1 border-t border-line" />
          <button role="menuitem" onClick={() => { setEdit(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-soft"><UserRound className="h-4 w-4" />Thông tin tài khoản</button>
          <button role="menuitem" onClick={() => { nav("/settings"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-soft"><Settings2 className="h-4 w-4" />Cài đặt & người dùng</button>
          {extra?.(() => setOpen(false))}
          {canLogout && <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-rose-600 hover:bg-soft"><LogOut className="h-4 w-4" />Đăng xuất</button>}
        </div>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title="Thông tin tài khoản">
        <AccountForm compact onSaved={() => setEdit(false)} />
      </Modal>
    </div>
  );
}
