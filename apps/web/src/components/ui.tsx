import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ExternalLink as ExternalLinkIcon, Info, Loader2, Sparkles, X, XCircle } from "lucide-react";
import type { Tone } from "../lib/format";

/**
 * Design system primitives. Guide: ui-design-system.md (tokens, props, patterns, do/don't).
 * Rules: every text block sits in a `min-w-0` parent, long free text uses `break-words` / `truncate` / `ExpandableText`,
 * and every interactive element is >= 40px tall on touch screens.
 */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const TONE: Record<Tone, string> = {
  green: "bg-ok-soft text-ok-ink",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  amber: "bg-warn-soft text-warn-ink",
  red: "bg-danger-soft text-danger-ink",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  gray: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  pink: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
};
const DOT: Record<Tone, string> = {
  green: "bg-ok", blue: "bg-blue-500", amber: "bg-warn", red: "bg-danger", violet: "bg-violet-500", gray: "bg-slate-400", pink: "bg-pink-500",
};
const TILE: Record<Tone, string> = {
  green: "from-emerald-400 to-emerald-500", blue: "from-sky-400 to-blue-500", amber: "from-amber-400 to-orange-500",
  red: "from-rose-400 to-rose-500", violet: "from-violet-400 to-fuchsia-500", gray: "from-slate-400 to-slate-500", pink: "from-pink-400 to-rose-500",
};
/** Soft icon chip used in card headers (calmer than the gradient IconTile). */
const CHIP: Record<Tone, string> = {
  green: "bg-ok-soft text-ok-ink", blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300", amber: "bg-warn-soft text-warn-ink",
  red: "bg-danger-soft text-danger-ink", violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300", gray: "bg-slate-500/10 text-slate-700 dark:text-slate-300", pink: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
};

/** Status chip. `dot` adds a coloured dot; `wrap` lets long text wrap (default: one truncated line that never overflows its box). */
export function Badge({ tone = "gray", children, className, dot, wrap, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; wrap?: boolean; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5", wrap ? "" : "whitespace-nowrap", TONE[tone], className)}>
      {dot && <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} />}
      {wrap ? children : <span className="min-w-0 truncate">{children}</span>}
    </span>
  );
}
/** Small status dot + label (e.g. "Đang chạy"). */
export function StatusDot({ tone = "gray", children, className }: { tone?: Tone; children?: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1.5 text-xs text-muted", className)}><span className={cx("h-2 w-2 shrink-0 rounded-full", DOT[tone])} />{children}</span>;
}

// ---------------- Collapsible sections: secondary content stays tucked away until asked for ----------------
const openStore = {
  get: (k: string): boolean | null => { try { const v = localStorage.getItem(`ui.open.${k}`); return v == null ? null : v === "1"; } catch { return null; } },
  set: (k: string, v: boolean) => { try { localStorage.setItem(`ui.open.${k}`, v ? "1" : "0"); } catch { /* storage unavailable */ } },
};
/** Open/closed state; with `persistKey` the user's choice is remembered per browser. */
export function useOpen(defaultOpen = false, persistKey?: string): [boolean, (v?: boolean) => void] {
  const [open, setOpen] = useState(() => (persistKey ? openStore.get(persistKey) : null) ?? defaultOpen);
  const toggle = useCallback((v?: boolean) => setOpen((o) => {
    const next = v ?? !o;
    if (persistKey) openStore.set(persistKey, next);
    return next;
  }), [persistKey]);
  return [open, toggle];
}
/** Animated height: children stay mounted (state is kept) but are out of the tab order while closed. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [settled, setSettled] = useState(open);
  useEffect(() => { if (!open) setSettled(false); }, [open]);
  return (
    <div className="collapse-grid" data-open={open} data-settled={open && settled} onTransitionEnd={(e) => { if (e.target === e.currentTarget) setSettled(open); }}>
      <div className={className} inert={!open}>{children}</div>
    </div>
  );
}
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <ChevronDown className={cx("h-4 w-4 shrink-0 text-muted transition-transform duration-200", open && "rotate-180", className)} />;
}
/** "Xem thêm / Thu gọn" — a quiet inline toggle for optional detail. */
export function MoreToggle({ open, onClick, more = "Xem thêm", less = "Thu gọn", className }: { open: boolean; onClick: () => void; more?: ReactNode; less?: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className={cx("inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-500/10 dark:text-blue-300", className)}>
      {open ? less : more}<Chevron open={open} className="h-3.5 w-3.5 text-current" />
    </button>
  );
}

const FOLD_DOT: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", blue: "bg-blue-500", gray: "bg-slate-400", violet: "bg-violet-500", pink: "bg-pink-500" };
/**
 * A quiet disclosure row for set-up, guidance and advanced options: one line when folded (title + short summary),
 * full content when opened. `tone` adds a status dot so the folded line still says whether attention is needed.
 */
export function Fold({ title, summary, icon: Icon, tone, defaultOpen = false, persistKey, action, children, className, bodyClass, flat }: { title: ReactNode; summary?: ReactNode; icon?: any; tone?: Tone; defaultOpen?: boolean; persistKey?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; flat?: boolean }) {
  const [open, toggle] = useOpen(defaultOpen, persistKey);
  return (
    <div className={cx("min-w-0 rounded-2xl border border-line", !flat && "bg-card shadow-card", className)}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => toggle()} aria-expanded={open} className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-soft">
          {tone && <span className={cx("h-2 w-2 shrink-0 rounded-full", FOLD_DOT[tone])} />}
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
          <span className="shrink-0 text-sm font-semibold text-ink">{title}</span>
          {summary != null && <span className={cx("min-w-0 flex-1 truncate text-xs text-muted transition-opacity", open && "opacity-0")}>{summary}</span>}
          {summary == null && <span className="flex-1" />}
          <Chevron open={open} />
        </button>
        {action && <div className="flex shrink-0 items-center gap-1.5 pr-1">{action}</div>}
      </div>
      <Collapse open={open}><div className={cx("px-4 pb-4 pt-1", bodyClass)}>{children}</div></Collapse>
    </div>
  );
}

/** A stack of warnings shown as one line + count; the full list drops down on demand so it never pushes the page away. */
export function AlertList({ items, action, noun = "mục cần chú ý" }: { items: string[]; action?: ReactNode; noun?: string }) {
  const [open, toggle] = useOpen(false);
  if (!items.length) return null;
  const many = items.length > 1;
  return (
    <div className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-ink">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" />
        <div className="min-w-0 flex-1 basis-48">
          {many && <p className="font-semibold">{items.length} {noun}</p>}
          <p className={cx("break-words", !open && many && "line-clamp-1", !open && !many && "line-clamp-2")}>{items[0]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 max-sm:basis-full max-sm:pl-7 sm:justify-end">
          {action}
          {many && <button type="button" onClick={() => toggle()} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium hover:bg-warn-soft">{open ? "Thu gọn" : "Xem tất cả"}<Chevron open={open} className="h-3.5 w-3.5 text-current" /></button>}
        </div>
      </div>
      {many && <Collapse open={open}><ul className="mt-2 space-y-1.5 border-t border-warn/25 pl-7 pt-2">{items.slice(1).map((w) => <li key={w} className="break-words">{w}</li>)}</ul></Collapse>}
    </div>
  );
}

/**
 * Text clamped to `lines` with an automatic "Xem thêm / Thu gọn" toggle (shown only when the text really overflows).
 * Use for summaries, descriptions, quotes — anything user/AI-written that can be long.
 */
const CLAMP: Record<number, string> = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 5: "line-clamp-5", 6: "line-clamp-6" };
export function ExpandableText({ children, lines = 2, className, textClass }: { children: ReactNode; lines?: 1 | 2 | 3 | 4 | 5 | 6; className?: string; textClass?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (!open) setClamped(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, open, lines]);
  return (
    <div className={cx("min-w-0", className)}>
      <p ref={ref} className={cx("break-words text-sm leading-relaxed", textClass ?? "text-muted", !open && CLAMP[lines])}>{children}</p>
      {(clamped || open) && <MoreToggle open={open} onClick={() => setOpen(!open)} className="-ml-2 mt-0.5" />}
    </div>
  );
}

/** External link that never widens its row: protocol stripped, truncated, full URL in the tooltip. Non-http values render as plain text. */
export function ExternalLink({ href, children, className, showIcon = true }: { href?: string | null; children?: ReactNode; className?: string; showIcon?: boolean }) {
  if (!href) return null;
  const safe = /^https?:\/\//i.test(href.trim());
  const label = children ?? href.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!safe) return <span className={cx("block min-w-0 truncate text-sm text-ink", className)} title={href}>{label}</span>;
  return (
    <a href={href.trim()} target="_blank" rel="noopener noreferrer" title={href.trim()} className={cx("inline-flex min-w-0 max-w-full items-center gap-1 rounded text-sm text-blue-700 hover:underline dark:text-blue-300", className)}>
      <span className="min-w-0 truncate">{label}</span>
      {showIcon && <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
    </a>
  );
}

// ---------------- Cards & sections ----------------
/**
 * Surface with an optional header. Original props: `title` `action` `children` `className` `bodyClass` `collapsible` `defaultOpen` `summary`.
 * New optional props: `icon` (+ `tone`) puts a soft icon chip before the title, `description` is a helper line under the title,
 * `footer` is a muted strip at the bottom, `divided` draws a rule under the header (form / section cards), `id` for anchors.
 * `collapsible`: the header becomes a toggle and the body folds away. Pass a string to remember the user's choice
 * under that key; `summary` shows next to the title while folded (a count, a status) so nothing important is hidden.
 */
export function Card({ title, action, children, className, bodyClass, collapsible, defaultOpen = true, summary, icon: Icon, tone = "blue", description, footer, divided, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; collapsible?: boolean | string; defaultOpen?: boolean; summary?: ReactNode; icon?: any; tone?: Tone; description?: ReactNode; footer?: ReactNode; divided?: boolean; id?: string }) {
  const [open, toggle] = useOpen(defaultOpen, typeof collapsible === "string" ? collapsible : undefined);
  const shell = cx("min-w-0 rounded-2xl border border-line bg-card shadow-card", className);
  const chip = Icon ? <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", CHIP[tone])}><Icon className="h-4 w-4" aria-hidden /></span> : null;
  const foot = footer ? <div className="rounded-b-2xl border-t border-line bg-soft/60 px-4 py-3 text-sm text-muted sm:px-5">{footer}</div> : null;
  if (collapsible) {
    return (
      <section id={id} className={shell}>
        <header className="flex min-h-14 items-center gap-2 px-4 py-2 sm:px-5">
          <button type="button" onClick={() => toggle()} aria-expanded={open} className="-mx-2 flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-soft">
            <Chevron open={open} />
            {chip}
            <span className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold leading-snug text-ink">{title}</h2>
              {description && <span className="block truncate text-xs text-muted">{description}</span>}
            </span>
            {summary != null && !open && <span className="ml-1 hidden min-w-0 max-w-[40%] truncate text-xs font-normal text-muted sm:block">{summary}</span>}
          </button>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
        <Collapse open={open}><div className={cx("px-4 pb-4 pt-1 sm:px-5 sm:pb-5", bodyClass)}>{children}</div></Collapse>
        {foot}
      </section>
    );
  }
  const hasHeader = Boolean(title || action);
  return (
    <section id={id} className={shell}>
      {hasHeader && (
        <header className={cx("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5", divided && "border-b border-line pb-3 sm:pb-4")}>
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            {chip}
            <div className="min-w-0">
              <h2 className="break-words text-[15px] font-semibold leading-snug text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p>}
            </div>
          </div>
          {action && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 [&>select]:w-auto">{action}</div>}
        </header>
      )}
      <div className={cx("p-4 sm:p-5", hasHeader && !divided && "pt-3 sm:pt-3", bodyClass)}>{children}</div>
      {foot}
    </section>
  );
}
/** Section card for forms and profile-like content: Card with `divided` on. */
export function Section(props: Parameters<typeof Card>[0]) {
  return <Card divided {...props} />;
}
/** Heading inside a page (between cards): title + optional description + actions. Smaller than PageHeader. */
export function SectionHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function IconTile({ icon: Icon, tone = "blue", size = "md" }: { icon: any; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <div className={cx("grid shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", TILE[tone], size === "md" ? "h-11 w-11" : "h-9 w-9")}>
      <Icon className={size === "md" ? "h-5 w-5" : "h-[18px] w-[18px]"} />
    </div>
  );
}

export function Delta({ value, invert, suffix = "so với 7 ngày trước" }: { value: number | null | undefined; invert?: boolean; suffix?: string }) {
  if (value == null) return <p className="truncate text-xs text-muted" title={suffix}>{suffix}</p>;
  const good = invert ? value <= 0 : value >= 0;
  const Arrow = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span className={cx("inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good ? "bg-ok-soft text-ok-ink" : "bg-danger-soft text-danger-ink")}><Arrow className="h-3 w-3" />{Math.abs(value)}%</span>
      <span className="truncate" title={suffix}>{suffix}</span>
    </p>
  );
}

/**
 * KPI tile. Layout: one-line label on top (full width, never wraps; full text in the tooltip), then the big number
 * with the icon tile beside it, then one muted line. Every tile in a row therefore has the same three-row rhythm.
 */
export function Stat({ icon, tone, label, value, delta, invert, sub, suffix }: { icon: any; tone: Tone; label: string; value: ReactNode; delta?: number | null; invert?: boolean; sub?: ReactNode; suffix?: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-between gap-2.5 rounded-2xl border border-line bg-card p-4 shadow-card transition-shadow hover:shadow-pop sm:p-[1.125rem]">
      <p className="truncate text-[13px] font-medium text-muted" title={label}>{label}</p>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[1.65rem] font-bold leading-none tabular-nums tracking-tight text-ink" title={typeof value === "string" ? value : undefined}>{value}</p>
        <IconTile icon={icon} tone={tone} size="sm" />
      </div>
      <div className="min-h-[1.25rem]">
        {delta !== undefined ? <Delta value={delta} invert={invert} suffix={suffix} /> : sub ? <div className="truncate text-xs text-muted" title={typeof sub === "string" ? sub : undefined}>{sub}</div> : null}
      </div>
    </div>
  );
}

// ---------------- Buttons ----------------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "soft" | "dangerSoft";
type BtnSize = "sm" | "md" | "lg";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
  secondary: "border border-line-strong bg-card text-ink hover:bg-soft",
  ghost: "text-muted hover:bg-soft hover:text-ink",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  success: "bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm",
  soft: "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300",
  dangerSoft: "border border-danger/30 text-danger-ink hover:bg-danger-soft",
};
const BTN_SIZE: Record<BtnSize, string> = {
  sm: "h-9 px-3 text-[13px] max-sm:h-10",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};
const BTN_SQUARE: Record<BtnSize, string> = { sm: "w-9 max-sm:w-10", md: "w-10", lg: "w-12" };
/**
 * Variants: primary (ONE per view), secondary (default), soft, ghost (toolbar / row actions), danger (destructive, solid),
 * dangerSoft (destructive, quiet), success. A button with no children becomes a square icon button (give it aria-label).
 * `loading` shows a spinner and disables the button. `iconRight` places the icon after the label. Sizes sm (36px, 40px on phones) / md 40 / lg 48.
 */
export function Button({ variant = "secondary", size = "md", icon: Icon, iconRight, children, loading, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; icon?: any; iconRight?: boolean; loading?: boolean }) {
  const iconOnly = children == null || children === false;
  const iconEl = loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null;
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={cx("inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50", BTN_SIZE[size], iconOnly && cx("!px-0", BTN_SQUARE[size]), BTN[variant], className)}>
      {!iconRight && iconEl}
      {children}
      {iconRight && iconEl}
    </button>
  );
}

export function Progress({ value, tone = "blue", className, label }: { value: number; tone?: Tone; className?: string; label?: string }) {
  const bar = { blue: "bg-blue-500", green: "bg-ok", amber: "bg-warn", red: "bg-danger", violet: "bg-violet-500", gray: "bg-slate-400", pink: "bg-pink-500" }[tone];
  const v = Math.max(0, Math.min(100, value));
  return <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={cx("h-2 w-full overflow-hidden rounded-full bg-soft", className)}><div className={cx("h-full rounded-full transition-all", bar)} style={{ width: `${v}%` }} /></div>;
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

/** Underline tabs (default) or `variant="pill"` segmented control. Arrow keys move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, variant = "line", className }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; variant?: "line" | "pill"; className?: string }) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.value === value);
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    const host = e.currentTarget as HTMLElement;
    onChange(n.value);
    requestAnimationFrame(() => host.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div role="tablist" onKeyDown={onKey} className={cx("no-scrollbar flex overflow-x-auto", variant === "line" ? "gap-1 border-b border-line" : "w-fit max-w-full gap-1 rounded-xl bg-soft p-1", className)}>
      {tabs.map((t) => {
        const on = value === t.value;
        return (
          <button key={t.value} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.value)}
            className={cx("whitespace-nowrap text-sm font-medium transition",
              variant === "line"
                ? cx("-mb-px min-h-11 border-b-2 px-3 py-2.5", on ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-muted hover:text-ink")
                : cx("min-h-9 rounded-lg px-3.5 py-1.5", on ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"))}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, size = "md", label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md"; label?: string }) {
  const sm = size === "sm";
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cx("relative shrink-0 rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] disabled:cursor-not-allowed disabled:opacity-50", sm ? "h-5 w-9" : "h-6 w-11", checked ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600")}>
      <span className={cx("absolute top-0.5 rounded-full bg-white shadow transition-[left]", sm ? "h-4 w-4" : "h-5 w-5", checked ? (sm ? "left-[18px]" : "left-[22px]") : "left-0.5")} />
    </button>
  );
}

// ---------------- Feedback: empty / loading / alert ----------------
/** Dashed empty placeholder. Optional `icon`, `title`, `action` make it a proper empty state (what is missing → what to do). */
export function Empty({ children, icon: Icon, title, action, className }: { children?: ReactNode; icon?: any; title?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-4 py-7 text-center text-sm text-muted", className)}>
      {Icon && <span className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-soft text-muted"><Icon className="h-5 w-5" aria-hidden /></span>}
      {title && <p className="text-[15px] font-semibold text-ink">{title}</p>}
      {children != null && <div className="max-w-md leading-relaxed">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{label}</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-soft", className)} />;
}
/** Placeholder rows while a list loads (avoids layout jump vs a lone spinner). */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Đang tải" className={cx("space-y-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line p-4"><Skeleton className="h-10 w-10 shrink-0 rounded-xl" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-4/5" /></div></div>
      ))}
    </div>
  );
}

const ALERT: Record<"info" | "warn" | "danger" | "ok", { box: string; icon: any }> = {
  info: { box: "border-info/25 bg-info-soft [&_.alert-ic]:text-info-ink", icon: Info },
  warn: { box: "border-warn/30 bg-warn-soft [&_.alert-ic]:text-warn-ink", icon: AlertTriangle },
  danger: { box: "border-danger/30 bg-danger-soft [&_.alert-ic]:text-danger-ink", icon: XCircle },
  ok: { box: "border-ok/30 bg-ok-soft [&_.alert-ic]:text-ok-ink", icon: CheckCircle2 },
};
/** Inline banner for hints / warnings / errors / success. Body text stays `text-ink` for contrast; tone shows in border, tint and icon. */
export function Alert({ tone = "info", title, children, action, icon, className }: { tone?: "info" | "warn" | "danger" | "ok"; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: any; className?: string }) {
  const t = ALERT[tone];
  const Icon = icon ?? t.icon;
  return (
    <div role={tone === "danger" || tone === "warn" ? "alert" : "status"} className={cx("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border p-3.5 text-sm text-ink sm:p-4", t.box, className)}>
      <Icon className="alert-ic mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 basis-60 space-y-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children != null && <div className="break-words">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------- Page header ----------------
/** Page title block. `subtitle` = one or two short sentences (what this page is for). `actions` = the primary action(s); `meta` = chips under the title. */
export function PageHeader({ title, subtitle, actions, meta }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0 md:max-w-[780px]">
        <h1 className="break-words text-xl font-bold leading-tight tracking-tight text-ink sm:text-[22px] lg:text-2xl">{title}</h1>
        {subtitle && (typeof subtitle === "string" ? <ExpandableText lines={2} className="mt-1.5">{subtitle}</ExpandableText> : <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>)}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 [&>select]:!w-auto">{actions}</div>}
    </div>
  );
}

/** Bar that sticks to the bottom (default) or top of the scrolling page area, above the mobile bottom navigation. */
export function StickyBar({ children, position = "bottom", className }: { children: ReactNode; position?: "top" | "bottom"; className?: string }) {
  return (
    <div className={cx("sticky z-30", position === "bottom" ? "bottom-[calc(var(--bottom-nav-h)+0.75rem)]" : "top-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line-strong bg-card/95 px-4 py-3 shadow-pop backdrop-blur animate-pop-in">{children}</div>
    </div>
  );
}
/** Unsaved-changes bar: appears only when `dirty`, keeps Save / Discard in reach while scrolling. Put it at the end of the page content. */
export function SaveBar({ dirty, saving, onSave, onDiscard, message = "Có thay đổi chưa lưu", saveLabel = "Lưu thay đổi", discardLabel = "Hủy thay đổi", disabled }: { dirty: boolean; saving?: boolean; onSave: () => void; onDiscard?: () => void; message?: ReactNode; saveLabel?: string; discardLabel?: string; disabled?: boolean }) {
  if (!dirty) return null;
  return (
    <StickyBar>
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-sm font-medium text-ink"><span className="h-2 w-2 shrink-0 rounded-full bg-warn" />{message}</span>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {onDiscard && <Button onClick={onDiscard} disabled={saving} className="max-sm:flex-1">{discardLabel}</Button>}
        <Button variant="primary" loading={saving} disabled={disabled} onClick={onSave} className="max-sm:flex-1">{saveLabel}</Button>
      </div>
    </StickyBar>
  );
}
/** Browser "leave site?" prompt while `dirty` (reload / close tab). */
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

// ---------------- Modal (dialog on desktop, bottom sheet on phones) ----------------
const modalStack: string[] = [];
const MODAL_W = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" } as const;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/**
 * `size` sm|md(default)|lg|xl (`wide` = lg, kept for compatibility). Header and footer stay put, the body scrolls.
 * On phones it is a bottom sheet (lg/xl fill the height). Esc closes only the top-most modal; focus is trapped and restored.
 * `closeOnBackdrop={false}` for forms with unsaved input. Put the primary action LAST in `footer`.
 */
export function Modal({ open, onClose, title, children, footer, wide, size, description, closeOnBackdrop = true, bodyClass }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; size?: "sm" | "md" | "lg" | "xl"; description?: ReactNode; closeOnBackdrop?: boolean; bodyClass?: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => { const el = box.current; if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[data-autofocus]") ?? el).focus(); }, 30);
    const k = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", k);
    return () => { clearTimeout(t); window.removeEventListener("keydown", k); const i = modalStack.indexOf(id); if (i >= 0) modalStack.splice(i, 1); prev?.focus?.(); };
  }, [open, id]);
  if (!open) return null;
  const sz = size ?? (wide ? "lg" : "md");
  const tall = sz === "lg" || sz === "xl";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-6" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}
        className={cx("flex w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-sheet outline-none animate-sheet-in sm:max-h-[88vh] sm:rounded-2xl", MODAL_W[sz], tall ? "h-[94dvh] sm:h-auto" : "max-h-[92dvh]")}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h3 id={`${id}-t`} className="break-words text-base font-semibold leading-snug text-ink">{title}</h3>
            {description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="-mr-1.5 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink sm:h-9 sm:w-9"><X className="h-5 w-5" /></button>
        </div>
        <div className={cx("scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5", bodyClass)}>{children}</div>
        {footer && <div className="pb-safe flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6 [&>button]:max-sm:w-full">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
/** Yes/no confirmation for destructive or irreversible actions. `tone="danger"` paints the confirm button red. */
export function ConfirmDialog({ open, title, children, confirmLabel = "Xác nhận", cancelLabel = "Hủy", tone = "primary", loading, onConfirm, onCancel }: { open: boolean; title: ReactNode; children?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: "primary" | "danger"; loading?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" title={title}
      footer={<><Button onClick={onCancel} disabled={loading}>{cancelLabel}</Button><Button variant={tone === "danger" ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm leading-relaxed text-ink">{children}</div>
    </Modal>
  );
}

// ---------------- Toasts ----------------
type ToastT = { id: number; text: string; tone: "ok" | "err" | "info" };
const ToastCtx = createContext<(text: string, tone?: ToastT["tone"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback((text: string, tone: ToastT["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "err" ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 top-16 z-[90] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-4 sm:top-auto sm:right-4 sm:items-end">
        {items.map((t) => {
          const I = t.tone === "err" ? XCircle : t.tone === "info" ? Info : CheckCircle2;
          return (
            <button key={t.id} type="button" onClick={() => dismiss(t.id)} role={t.tone === "err" ? "alert" : "status"} className={cx("pointer-events-auto flex w-full max-w-[400px] items-start gap-2.5 rounded-xl px-4 py-3 text-left text-sm leading-snug text-white shadow-pop animate-pop-in", t.tone === "err" ? "bg-rose-700" : t.tone === "info" ? "bg-slate-800" : "bg-emerald-700")}>
              <I className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 break-words">{t.text}</span>
            </button>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Jev visual language ----------------
export function JevBadge({ source }: { source?: string | null }) {
  return source === "jev"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-600 to-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white"><Sparkles className="h-3 w-3" />Jev</span>
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
  return <span className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: `hsl(${hue} 65% 42%)`, fontSize: size * 0.36 }}>{initials}</span>;
}

// ---------------- Forms ----------------
/**
 * Label + control + hint/error. Wraps the control in a <label>, so clicking the label focuses it.
 * `error` replaces the hint with a red message; `required` adds an asterisk; `optional` adds "(không bắt buộc)".
 */
export function Field({ label, children, hint, error, required, optional, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; optional?: boolean; className?: string }) {
  return (
    <label className={cx("block min-w-0 space-y-1.5", className)}>
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium text-ink">
        {label}
        {required && <span className="text-danger-ink" aria-hidden>*</span>}
        {optional && <span className="text-xs font-normal text-muted">(không bắt buộc)</span>}
      </span>
      {children}
      {error ? <span role="alert" className="block text-xs font-medium text-danger-ink">{error}</span> : hint ? <span className="block text-xs leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}
/** Class string for input / select / textarea (min 40px tall, 16px on phones so iOS does not zoom). */
export const inputCls = "w-full min-h-10 rounded-xl border border-line-strong bg-card px-3 py-2 text-base text-ink outline-none transition placeholder:text-muted/70 hover:border-muted/60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:bg-soft disabled:opacity-70 sm:text-sm";

/** VND amount input with thousand separators ("10.000.000") and a unit suffix. Empty = null. */
export function MoneyInput({ value, onChange, placeholder, suffix = "đ", className, disabled, id }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; suffix?: string; className?: string; disabled?: boolean; id?: string }) {
  return (
    <div className={cx("relative", className)}>
      <input id={id} inputMode="numeric" disabled={disabled} className={cx(inputCls, "pr-9 tabular-nums")} placeholder={placeholder}
        value={value == null ? "" : Math.round(value).toLocaleString("vi-VN")}
        onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 13); onChange(d === "" ? null : Number(d)); }} />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{suffix}</span>}
    </div>
  );
}

// ---------------- Lists, key-values, tables ----------------
/** Label → value rows (profile style). Labels stack above values on phones; empty values render "—". */
export function KeyValue({ items, labelWidth = "9rem", className }: { items: { label: ReactNode; value?: ReactNode }[]; labelWidth?: string; className?: string }) {
  return (
    <dl className={cx("grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[var(--kv-w)_minmax(0,1fr)] sm:gap-y-2.5", className)} style={{ ["--kv-w" as any]: labelWidth }}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-[13px] text-muted sm:pt-px">{it.label}</dt>
          <dd className="-mt-2 min-w-0 break-words text-ink sm:mt-0">{it.value == null || it.value === "" || it.value === false ? <span className="text-muted">—</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One row of a list: name → meta → badges → actions, never cramped columns.
 * lead = avatar/icon, title = main line (wraps), subtitle = muted line, badges = chips under the title, children = body
 * (use ExpandableText for long text), aside = right-hand value (e.g. price), actions = buttons (stack below on phones).
 * Wrap rows in <div className="space-y-3"> (cards) or use `flat` inside a divide-y list.
 */
export function ListRow({ lead, title, subtitle, badges, children, actions, aside, flat, className }: { lead?: ReactNode; title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; children?: ReactNode; actions?: ReactNode; aside?: ReactNode; flat?: boolean; className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4", flat ? "py-4" : "rounded-xl border border-line bg-card p-4", className)}>
      {lead && <div className="shrink-0">{lead}</div>}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="min-w-0 break-words text-[15px] font-semibold leading-snug text-ink">{title}</div>
        {subtitle && <div className="min-w-0 break-words text-xs text-muted">{subtitle}</div>}
        {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
        {children}
      </div>
      {aside && <div className="shrink-0 sm:text-right">{aside}</div>}
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">{actions}</div>}
    </div>
  );
}

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "left" | "right"; className?: string; primary?: boolean; hideOnMobile?: boolean };
/** Table on >= md, stacked cards on phones (the `primary` column becomes the card title; others show "header: value"). Never causes page-level horizontal scroll. */
export function DataTable<T>({ columns, rows, rowKey, empty, onRowClick }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; onRowClick?: (r: T) => void }) {
  if (!rows.length) return <Empty>{empty ?? "Chưa có dữ liệu."}</Empty>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  return (
    <>
      <div className="scroll-thin hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-soft/70 text-xs text-muted">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-2.5 font-medium", c.align === "right" && "text-right")}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("align-top", onRowClick && "cursor-pointer hover:bg-soft/60")}>
                {columns.map((c) => <td key={c.key} className={cx("px-4 py-3", c.align === "right" && "text-right", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((r) => (
          <div key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className="min-w-0 space-y-2 rounded-xl border border-line bg-card p-4">
            <div className="break-words text-[15px] font-semibold text-ink">{primary.cell(r)}</div>
            {columns.filter((c) => c !== primary && !c.hideOnMobile).map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 text-sm"><span className="shrink-0 text-muted">{c.header}</span><span className="min-w-0 break-words text-right text-ink">{c.cell(r)}</span></div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
