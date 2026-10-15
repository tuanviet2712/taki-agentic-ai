import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Radio, Telescope, HeartHandshake, PlaneTakeoff,
  Bell, BookOpen, BrainCircuit, Clapperboard, FileClock, FileText, Home, Library, Link2, Bot, CalendarDays, ChartLine, CheckCircle2,
  Mail, Megaphone, Menu, MessageCircle, MessagesSquare, MonitorCog, Moon, Network, Octagon, PanelLeftClose, PanelLeftOpen, Rocket, Route, Send, Settings, SlidersHorizontal, Sparkles, Sun, Target, X,
} from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Button, Chevron, Collapse, Modal, cx, useOpen, useToast } from "./ui";
import { AccountMenu, PROFILE_EVENT } from "./Account";
import { BusinessSwitcher } from "./BusinessSwitcher";

type NavItem = { to: string; label: string; icon: any; badge?: "unread" | "approvals"; special?: boolean; children?: { to: string; label: string; icon: any }[] };
const NAV: { title: string; items: NavItem[] }[] = [
  { title: "Điều hành", items: [
    { to: "/", label: "Tổng quan", icon: Home },
    { to: "/brain", label: "Agentic Brain", icon: BrainCircuit },
    { to: "/orchestra", label: "Bản đồ điều phối", icon: Network },
    { to: "/dna", label: "Mục tiêu & DNA", icon: Target },
    { to: "/plan", label: "Kế hoạch", icon: CalendarDays },
    { to: "/autopilot", label: "Lái tự động", icon: PlaneTakeoff, special: true },
    { to: "/agents", label: "Agent & Tác vụ", icon: Bot },
    { to: "/approvals", label: "Duyệt & Phê duyệt", icon: CheckCircle2, badge: "approvals" },
  ] },
  { title: "Nội dung & kênh", items: [
    { to: "/content", label: "Nội dung", icon: FileText },
    { to: "/video-flow", label: "Sản xuất video", icon: Clapperboard },
    { to: "/publish", label: "Đăng bài", icon: Send },
    { to: "/scout", label: "Trinh sát nội dung", icon: Telescope },
    { to: "/channels", label: "Kênh đăng", icon: Radio },
    { to: "/chat", label: "Chat & Khách hàng", icon: MessageCircle, badge: "unread" },
    { to: "/sales-flow", label: "Kịch bản chốt đơn", icon: Route },
    { to: "/nurture", label: "Chăm khách từ bình luận", icon: HeartHandshake },
    { to: "/zalo", label: "Follow-up Zalo", icon: MessagesSquare },
    { to: "/email", label: "Email marketing", icon: Mail },
  ] },
  { title: "Quảng cáo", items: [
    { to: "/ads/flows?type=metrics_pull", label: "AI Agent Ads", icon: Megaphone, special: true, children: [
      { to: "/ads/flows?type=auto_off", label: "Luồng vận hành", icon: SlidersHorizontal },
      { to: "/ads/quick", label: "Tạo chiến dịch nhanh", icon: Rocket },
      { to: "/ads/stats", label: "Thống kê quảng cáo", icon: ChartLine },
    ] },
  ] },
  { title: "Đo lường & tri thức", items: [
    { to: "/reports", label: "Đo lường & Báo cáo", icon: ChartLine },
    { to: "/knowledge", label: "Kho tri thức", icon: BookOpen },
    { to: "/skills", label: "Skill & Nhân viên MKT", icon: Library },
  ] },
  { title: "Hệ thống", items: [
    { to: "/ads/integrations", label: "Trung tâm tích hợp", icon: Link2 },
    { to: "/ads/ai-gateway", label: "Cổng AI (MCP)", icon: MonitorCog },
    { to: "/ads/logs", label: "Lịch sử hoạt động", icon: FileClock },
    { to: "/jev", label: "Jev · System One", icon: Sparkles, special: true },
    { to: "/settings", label: "Cài đặt", icon: Settings },
  ] },
];
/** Bottom bar on phones: the four things checked most often + "Menu" for everything else. */
const TABBAR: { to: string; label: string; icon: any; badge?: "unread" | "approvals" }[] = [
  { to: "/", label: "Tổng quan", icon: Home },
  { to: "/content", label: "Nội dung", icon: FileText },
  { to: "/chat", label: "Chat", icon: MessageCircle, badge: "unread" },
  { to: "/approvals", label: "Duyệt", icon: CheckCircle2, badge: "approvals" },
];

const railStore = {
  get: (): boolean => { try { const v = localStorage.getItem("ui.sidebar"); return v ? v === "rail" : window.innerWidth < 1280; } catch { return false; } },
  set: (rail: boolean) => { try { localStorage.setItem("ui.sidebar", rail ? "rail" : "full"); } catch { /* storage unavailable */ } },
};

export function Layout({ children }: { children: ReactNode }) {
  const { data: sys, reload } = useApi<any>("system", ["approval.", "conversation.", "lead.", "alert.", "llm."]);
  useEffect(() => {
    const r = () => void reload();
    window.addEventListener(PROFILE_EVENT, r);
    return () => window.removeEventListener(PROFILE_EVENT, r);
  }, [reload]);
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(railStore.get);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("theme") === "dark"; } catch { return false; }
  });
  const [notes, setNotes] = useState<{ text: string; at: string; level?: string }[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const [killOpen, setKillOpen] = useState(false);
  const toast = useToast();
  const loc = useLocation();
  // "Mở như app": install as a desktop app (Chrome/Edge PWA install prompt)
  const [installEvt, setInstallEvt] = useState<any>(null);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const standalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  useEffect(() => {
    setOpen(false);
    setShowNotes(false);
  }, [loc.pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  useEffect(() => {
    if (!open && !showNotes) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setShowNotes(false); } };
    const away = (e: MouseEvent) => { if (showNotes && notesRef.current && !notesRef.current.contains(e.target as Node)) setShowNotes(false); };
    window.addEventListener("keydown", esc);
    window.addEventListener("mousedown", away);
    return () => { window.removeEventListener("keydown", esc); window.removeEventListener("mousedown", away); };
  }, [open, showNotes]);

  useEvents((e) => {
    const map: Record<string, (p: any) => string | null> = {
      "approval.created": (p) => `Cần duyệt: ${p.title ?? "mục mới"}`,
      "conversation.handoff": (p) => `Chuyển người: ${(p.reasons ?? []).join(", ")}`,
      "post.published": (p) => (p.simulated ? `Mô phỏng (CHƯA đăng thật lên ${p.channel ?? "kênh"}): ${p.title}` : `Đã đăng: ${p.title}`),
      "action.executed": (p) => `Đã thực hiện ${p.type} · ${p.target ?? ""}`,
      "alert.raised": (p) => p.text,
      "proposal.created": (p) => `Đề xuất học: ${p.title}`,
    };
    const f = map[e.type];
    const text = f?.(e.payload);
    if (text) setNotes((n) => [{ text, at: new Date().toISOString(), level: e.payload.level }, ...n].slice(0, 30));
  });

  const killed = sys?.killSwitch && Object.values(sys.killSwitch).some(Boolean);
  const setKill = async (area: string, on: boolean) => {
    await api.post("kill-switch", { area, on });
    toast(on ? `Đã DỪNG khẩn cấp: ${area}` : `Đã mở lại: ${area}`, on ? "err" : "ok");
    reload();
  };
  const toggleRail = () => setRail((r) => { railStore.set(!r); return !r; });

  const here = loc.pathname + loc.search;
  /** `compact` = icon-only rail (tablet); the drawer on phones always uses the full layout. */
  const sidebar = (compact: boolean) => (
    <nav aria-label="Điều hướng chính" className={cx("min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-1 scroll-thin", compact ? "px-2" : "px-3")}>
      {NAV.map((g) => {
        const rows = g.items.map((n) => {
          const count = n.badge ? sys?.counts?.[n.badge] : 0;
          return (
            <div key={n.to}>
              <NavLink to={n.to} end={n.to === "/" || n.to === "/ads"} title={compact ? n.label : undefined} aria-label={compact ? n.label : undefined}
                className={({ isActive }) => {
                  const on = isActive && !(n.children && loc.search);
                  return cx(
                    "group relative flex min-h-9 items-center rounded-xl text-[13.5px] transition-colors",
                    compact ? "justify-center px-0" : "gap-3 px-3",
                    on ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink/80 hover:bg-soft hover:text-ink",
                  );
                }}>
                <n.icon className={cx("h-[18px] w-[18px] shrink-0", n.special && "text-violet-600 dark:text-violet-400")} aria-hidden />
                {!compact && <span className="min-w-0 flex-1 truncate" title={n.label}>{n.label}</span>}
                {count ? (compact
                  ? <span className="absolute right-1.5 top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-card" />
                  : <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{count}</span>) : null}
              </NavLink>
              {!compact && n.children?.map((c) => (
                <NavLink key={c.to} to={c.to} className={() => cx("ml-5 flex min-h-9 items-center gap-3 rounded-xl px-3 py-1.5 text-[13px] transition-colors", here === c.to ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink/75 hover:bg-soft hover:text-ink")}>
                  <c.icon className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 truncate">{c.label}</span>
                </NavLink>
              ))}
            </div>
          );
        });
        return compact
          ? <div key={g.title} className="space-y-0.5 border-b border-line py-2 first:pt-1 last:border-0">{rows}</div>
          : (
            <NavGroup key={g.title} title={g.title} active={g.items.some((n) => [n, ...(n.children ?? [])].some((x) => x.to.split("?")[0] === loc.pathname))}
              alert={g.items.reduce((a, n) => a + (n.badge ? sys?.counts?.[n.badge] ?? 0 : 0), 0)}>
              {rows}
            </NavGroup>
          );
      })}
    </nav>
  );
  const status = (compact: boolean) => (
    <div className={cx("shrink-0 border-t border-line text-[11px] text-muted", compact ? "flex flex-col items-center gap-2 py-3" : "space-y-1 px-4 py-2.5")}>
      <ModeRow compact={compact} label="Jev (System One)" on={sys?.jev?.enabled} offText="heuristic" />
      <ModeRow compact={compact} label={sys?.llm?.provider === "codex_cli" ? "ChatGPT (Codex)" : "Claude (LLM)"} on={sys?.llm?.enabled} offText={sys?.llm?.provider === "codex_cli" ? "chưa kết nối" : "sandbox"} />
      <NavLink to="/ads/integrations" className="block rounded-lg"><ModeRow compact={compact} label="Nền tảng" on={(sys?.connections?.live ?? 0) > 0} onText={`${sys?.connections?.live ?? 0} LIVE`} offText={sys?.connections?.sandbox ? "mô phỏng" : "chưa kết nối"} /></NavLink>
    </div>
  );
  const pendingTotal = (sys?.counts?.approvals ?? 0) + (sys?.counts?.unread ?? 0);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only z-[100] rounded-lg bg-card px-3 py-2 text-sm font-medium text-ink shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Bỏ qua điều hướng</a>
      {/* Tablet / desktop: full sidebar, or an icon rail the user can fold (remembered). */}
      <aside className={cx("hidden shrink-0 flex-col border-r border-line bg-card transition-[width] duration-200 md:flex", rail ? "w-[68px]" : "w-60")}>
        <Brand compact={rail} />
        {sidebar(rail)}
        {status(rail)}
      </aside>
      {/* Phones: slide-in drawer */}
      {open && (
        <div className="fixed inset-0 z-[60] bg-slate-950/50 animate-fade-in md:hidden" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Menu" className="flex h-full w-[min(20rem,86vw)] flex-col bg-card shadow-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-2"><Brand /><button onClick={() => setOpen(false)} aria-label="Đóng menu" className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-soft"><X className="h-5 w-5" /></button></div>
            {sidebar(false)}
            {status(false)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-card/80 px-3 backdrop-blur-md sm:gap-2 md:px-5 lg:px-8">
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink md:hidden" onClick={() => setOpen(true)} aria-label="Mở menu"><Menu className="h-5 w-5" /></button>
          <button className="hidden h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink md:grid" onClick={toggleRail} aria-label={rail ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} title={rail ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}>{rail ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}</button>
          <BusinessSwitcher />
          <div className="flex-1" />
          {!standalone && installEvt && <Button className="hidden lg:inline-flex" size="sm" variant="ghost" icon={MonitorCog} onClick={async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => null); setInstallEvt(null); }}>Mở như app</Button>}
          <Button variant={killed ? "danger" : "secondary"} size="sm" icon={Octagon} aria-label={killed ? "Đang dừng khẩn cấp" : "Dừng khẩn cấp"} title={killed ? "Đang dừng khẩn cấp" : "Dừng khẩn cấp"} onClick={() => setKillOpen(true)} className="max-lg:!px-0 max-lg:w-10"><span className="hidden lg:inline">{killed ? "Đang dừng khẩn cấp" : "Dừng khẩn cấp"}</span></Button>
          <button onClick={() => setDark(!dark)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink" aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">{dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
          <div className="relative" ref={notesRef}>
            <button onClick={() => setShowNotes(!showNotes)} className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink" aria-label="Thông báo" aria-expanded={showNotes} title="Thông báo">
              <Bell className="h-5 w-5" />
              {notes.length > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">{notes.length}</span>}
            </button>
            {showNotes && (
              <div className="absolute right-[-3.5rem] top-12 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-card p-2 shadow-pop animate-pop-in sm:right-0">
                <p className="px-2 py-1.5 text-sm font-semibold">Thông báo thời gian thực</p>
                {notes.length === 0 ? <p className="px-2 py-3 text-sm text-muted">Chưa có sự kiện mới.</p> : (
                  <div className="max-h-[60vh] overflow-y-auto scroll-thin">
                    {notes.map((n, i) => (
                      <div key={i} className="rounded-lg px-2 py-2 text-sm hover:bg-soft"><p className={cx("break-words", n.level === "urgent" && "text-danger-ink")}>{n.text}</p><p className="text-xs text-muted">{timeAgo(n.at)}</p></div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <AccountMenu profile={sys?.profile} canLogout={false} onLogout={() => {}} />
        </header>
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto scroll-thin outline-none">
          {/* One consistent page frame: max width, gutters, bottom room for the assistant chip + phone tab bar. */}
          <div className="mx-auto w-full max-w-[1280px] px-4 pb-[calc(var(--bottom-nav-h)+6rem)] pt-5 sm:px-6 md:pb-24 md:pt-7 lg:px-8">{children}</div>
        </main>
      </div>

      {/* Phones: bottom tab bar (thumb reach) */}
      <nav aria-label="Điều hướng nhanh" className="pb-safe fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-line bg-card/95 backdrop-blur md:hidden">
        {TABBAR.map((t) => {
          const c = t.badge ? sys?.counts?.[t.badge] : 0;
          return (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => cx("relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors", isActive ? "text-blue-700 dark:text-blue-300" : "text-muted")}>
              <span className="relative"><t.icon className="h-5 w-5" aria-hidden />{c ? <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">{c}</span> : null}</span>
              <span className="max-w-full truncate px-1">{t.label}</span>
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted" aria-label="Mở toàn bộ menu">
          <Menu className="h-5 w-5" aria-hidden /><span>Menu</span>
          {pendingTotal > 0 && <span className="sr-only">{pendingTotal} mục cần xử lý</span>}
        </button>
      </nav>

      <Modal open={killOpen} onClose={() => setKillOpen(false)} title="Nút dừng khẩn cấp (kill switch)" description="Dừng ngay mọi tác động ra ngoài của nhóm tương ứng. Việc đang xếp hàng sẽ bị chặn; Sếp mở lại bất cứ lúc nào.">
        <div className="space-y-2">
          {[["publish", "Đăng bài"], ["ads", "Quảng cáo (không chặn thao tác TẮT ads)"], ["chat", "Chat bot (chuyển hết sang người)"], ["all", "Toàn hệ thống"]].map(([k, l]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="min-w-0 text-sm font-medium">{l}</span>
              <Button size="sm" variant={sys?.killSwitch?.[k] ? "success" : "danger"} onClick={() => setKill(k, !sys?.killSwitch?.[k])}>{sys?.killSwitch?.[k] ? "Mở lại" : "Dừng"}</Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** Sidebar section that folds away; the section holding the current page always stays open. */
function NavGroup({ title, active, alert, children }: { title: string; active: boolean; alert: number; children: ReactNode }) {
  const [open, toggle] = useOpen(false, `nav.${title}`);
  const shown = open || active;
  return (
    <div className="py-0.5">
      <button type="button" onClick={() => toggle(!shown)} aria-expanded={shown} className={cx("flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider hover:bg-soft hover:text-ink", shown ? "text-ink" : "text-muted")}>
        <span className="flex-1">{title}</span>
        {!shown && alert > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold normal-case tracking-normal text-white">{alert}</span>}
        <Chevron open={shown} className="h-3.5 w-3.5" />
      </button>
      <Collapse open={shown}><div className="space-y-0.5">{children}</div></Collapse>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className={cx("flex h-14 shrink-0 items-center gap-2", compact ? "justify-center" : "px-5")}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-sm"><Sparkles className="h-[18px] w-[18px]" aria-hidden /></span>
      {!compact && <span className="text-lg font-bold tracking-tight">Agentic AI</span>}
    </div>
  );
}
function ModeRow({ label, on, offText, onText = "LIVE", compact }: { label: string; on?: boolean; offText: string; onText?: string; compact?: boolean }) {
  if (compact) return <span title={`${label}: ${on ? onText : offText}`} className={cx("h-2.5 w-2.5 rounded-full", on ? "bg-ok" : "bg-warn")} />;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate">{label}</span>
      <span className={cx("inline-flex shrink-0 items-center gap-1.5 font-medium", on ? "text-ok-ink" : "text-warn-ink")}><span className={cx("h-1.5 w-1.5 rounded-full", on ? "bg-ok" : "bg-warn")} />{on ? onText : offText}</span>
    </div>
  );
}
