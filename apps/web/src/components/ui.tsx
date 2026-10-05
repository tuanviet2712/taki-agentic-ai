import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import type { Tone } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const TONE: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  gray: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  pink: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
};
const TILE: Record<Tone, string> = {
  green: "from-emerald-400 to-emerald-500", blue: "from-sky-400 to-blue-500", amber: "from-amber-400 to-orange-500",
  red: "from-rose-400 to-rose-500", violet: "from-violet-400 to-fuchsia-500", gray: "from-slate-400 to-slate-500", pink: "from-pink-400 to-rose-500",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{children}</span>;
}

export function Card({ title, action, children, className, bodyClass }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={cx("p-5", title || action ? "pt-3" : "", bodyClass)}>{children}</div>
    </section>
  );
}

export function IconTile({ icon: Icon, tone = "blue", size = "md" }: { icon: any; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <div className={cx("grid shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", TILE[tone], size === "md" ? "h-12 w-12" : "h-9 w-9")}>
      <Icon className={size === "md" ? "h-6 w-6" : "h-4.5 w-4.5"} />
    </div>
  );
}

export function Delta({ value, invert, suffix = "so với 7 ngày trước" }: { value: number | null | undefined; invert?: boolean; suffix?: string }) {
  if (value == null) return <p className="text-xs text-muted">{suffix}</p>;
  const good = invert ? value <= 0 : value >= 0;
  const Arrow = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <div className="space-y-0.5">
      <p className={cx("flex items-center gap-1 text-sm font-medium", good ? "text-emerald-600" : "text-rose-500")}><Arrow className="h-3.5 w-3.5" />{Math.abs(value)}%</p>
      <p className="text-xs text-muted">{suffix}</p>
    </div>
  );
}

export function Stat({ icon, tone, label, value, delta, invert, sub, suffix }: { icon: any; tone: Tone; label: string; value: ReactNode; delta?: number | null; invert?: boolean; sub?: ReactNode; suffix?: string }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted">{label}</p>
        <p className="truncate text-2xl font-bold tracking-tight text-ink">{value}</p>
        {delta !== undefined ? <Delta value={delta} invert={invert} suffix={suffix} /> : sub ? <div className="text-xs text-muted">{sub}</div> : null}
      </div>
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "soft";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
  secondary: "border border-line bg-card text-ink hover:bg-soft",
  ghost: "text-muted hover:bg-soft hover:text-ink",
  danger: "bg-rose-500 text-white hover:bg-rose-600",
  success: "bg-emerald-500 text-white hover:bg-emerald-600",
  soft: "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300",
};
export function Button({ variant = "secondary", size = "md", icon: Icon, children, loading, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; icon?: any; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cx("inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm", BTN[variant], className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Progress({ value, tone = "blue", className }: { value: number; tone?: Tone; className?: string }) {
  const bar = { blue: "bg-blue-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", violet: "bg-violet-500", gray: "bg-slate-400", pink: "bg-pink-500" }[tone];
  return <div className={cx("h-2 w-full overflow-hidden rounded-full bg-soft", className)}><div className={cx("h-full rounded-full transition-all", bar)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Ring({ value, size = 140, stroke = 12, children, color = "#10b981" }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--soft)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value / 100))} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition", value === t.value ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50", checked ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600")}>
      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}
export function Loading() {
  return <div className="flex items-center gap-2 p-6 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Đang tải…</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted md:text-base">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------- Modal (confirmation with preview for every external action) ----------------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cx("max-h-[90vh] w-full overflow-auto rounded-2xl border border-line bg-card shadow-2xl scroll-thin", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-soft"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- Toasts ----------------
type ToastT = { id: number; text: string; tone: "ok" | "err" | "info" };
const ToastCtx = createContext<(text: string, tone?: ToastT["tone"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((text: string, tone: ToastT["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx("rounded-xl px-4 py-3 text-sm shadow-lg", t.tone === "err" ? "bg-rose-600 text-white" : t.tone === "info" ? "bg-slate-800 text-white" : "bg-emerald-600 text-white")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Jev visual language ----------------
export function JevBadge({ source }: { source?: string | null }) {
  return source === "jev"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white"><Sparkles className="h-3 w-3" />Jev</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-muted" title="Chưa có TYPESAFE_API_KEY — dùng heuristic cùng định dạng câu trả lời Jev"><Sparkles className="h-3 w-3" />Jev·heuristic</span>;
}
export function ProbBar({ label, p, tone = "violet", hint }: { label: ReactNode; p: number; tone?: Tone; hint?: string }) {
  return (
    <div className="space-y-1" title={hint}>
      <div className="flex justify-between text-xs"><span className="text-ink">{label}</span><span className="tabular-nums text-muted">{Math.round(p * 100)}%</span></div>
      <Progress value={p * 100} tone={tone} />
    </div>
  );
}

// ---------------- Platform icons (brand-colored chips; no external logos) ----------------
const PLAT: Record<string, { bg: string; t: string; name: string }> = {
  facebook: { bg: "#1877F2", t: "f", name: "Facebook" }, meta: { bg: "#0866FF", t: "∞", name: "Meta Ads" }, messenger: { bg: "#0A7CFF", t: "m", name: "Messenger" },
  instagram: { bg: "linear-gradient(45deg,#f09433,#dc2743,#bc1888)", t: "IG", name: "Instagram" }, tiktok: { bg: "#111", t: "♪", name: "TikTok" },
  youtube: { bg: "#FF0000", t: "▶", name: "YouTube" }, google: { bg: "#fff", t: "G", name: "Google" }, google_ads: { bg: "#fff", t: "G", name: "Google Ads" },
  google_search: { bg: "#fff", t: "G", name: "Google" }, zalo: { bg: "#0068FF", t: "Z", name: "Zalo" }, website: { bg: "#f97316", t: "W", name: "Website" },
  cms: { bg: "#21759b", t: "W", name: "WordPress" }, pancake: { bg: "#1DA1F2", t: "P", name: "Pancake" }, sheets: { bg: "#0F9D58", t: "▦", name: "Google Sheets" },
  telegram: { bg: "#229ED9", t: "✈", name: "Telegram" }, email: { bg: "#64748b", t: "@", name: "Email" }, friend_referral: { bg: "#8b5cf6", t: "♥", name: "Giới thiệu" },
  event_or_seminar: { bg: "#f59e0b", t: "★", name: "Sự kiện" }, simulator: { bg: "#64748b", t: "S", name: "Mô phỏng" },
};
export const platformName = (p: string) => PLAT[p]?.name ?? p;
export function PlatformIcon({ p, size = 20 }: { p: string; size?: number }) {
  const x = PLAT[p] ?? { bg: "#94a3b8", t: "?", name: p };
  const google = x.t === "G" && x.bg === "#fff";
  return (
    <span title={x.name} className="inline-grid shrink-0 place-items-center rounded-full font-bold leading-none" style={{ width: size, height: size, background: x.bg, color: google ? "#4285F4" : "#fff", fontSize: size * (x.t.length > 1 ? 0.38 : 0.55), border: google ? "1px solid #e2e8f0" : undefined }}>
      {x.t}
    </span>
  );
}

export function Avatar({ name, size = 36, src, onError }: { name: string; size?: number; src?: string | null; onError?: () => void }) {
  if (src) return <img src={src} alt={name} onError={onError} className="inline-block shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  const initials = name.split(" ").filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase();
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: `hsl(${hue} 65% 55%)`, fontSize: size * 0.36 }}>{initials}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const inputCls = "w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
