import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity, Bell, BookOpen, BrainCircuit, Clapperboard, Columns2, CreditCard, FileClock, FileText, Home, Library, Link2, Bot, CalendarDays, ChartLine, CheckCircle2,
  ChevronDown, LayoutTemplate, Megaphone, Menu, MessageCircle, MessagesSquare, MonitorCog, Moon, Network, Octagon, Play, Rocket, Send, Settings, SlidersHorizontal, Sparkles, Sun, Target, X,
} from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Button, Modal, cx, useToast } from "./ui";
import { AccountMenu, PROFILE_EVENT } from "./Account";

type NavItem = { to: string; label: string; icon: any; badge?: "unread" | "approvals"; special?: boolean; children?: { to: string; label: string; icon: any }[] };
const NAV: { title: string; items: NavItem[] }[] = [
  { title: "Điều hành", items: [
    { to: "/", label: "Tổng quan", icon: Home },
    { to: "/brain", label: "Agentic Brain", icon: BrainCircuit },
    { to: "/orchestra", label: "Bản đồ điều phối", icon: Network },
    { to: "/dna", label: "Mục tiêu & DNA", icon: Target },
    { to: "/plan", label: "Kế hoạch", icon: CalendarDays },
    { to: "/agents", label: "Agent & Tác vụ", icon: Bot },
    { to: "/approvals", label: "Duyệt & Phê duyệt", icon: CheckCircle2, badge: "approvals" },
  ] },
  { title: "Nội dung & kênh", items: [
    { to: "/content", label: "Nội dung", icon: FileText },
    { to: "/video-flow", label: "Sản xuất video", icon: Clapperboard },
    { to: "/publish", label: "Đăng bài", icon: Send },
    { to: "/chat", label: "Chat & Khách hàng", icon: MessageCircle, badge: "unread" },
    { to: "/zalo", label: "Follow-up Zalo", icon: MessagesSquare },
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

export function Layout({ children }: { children: ReactNode }) {
  const { data: sys, reload } = useApi<any>("system", ["approval.", "conversation.", "lead.", "alert."]);
  useEffect(() => {
    const r = () => void reload();
    window.addEventListener(PROFILE_EVENT, r);
    return () => window.removeEventListener(PROFILE_EVENT, r);
  }, [reload]);
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("theme") === "dark"; } catch { return false; }
  });
  const [notes, setNotes] = useState<{ text: string; at: string; level?: string }[]>([]);
  const [showNotes, setShowNotes] = useState(false);
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
  }, [loc.pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);

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

  const here = loc.pathname + loc.search;
  const sidebar = (
    <nav className="flex h-full flex-col overflow-y-auto p-3 scroll-thin">
      {NAV.map((g) => (
        <div key={g.title} className="mb-2 border-b border-line pb-2 last:border-0">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</p>
          {g.items.map((n) => {
            const count = n.badge ? sys?.counts?.[n.badge] : 0;
            return (
              <div key={n.to}>
                <NavLink to={n.to} end={n.to === "/" || n.to === "/ads"} className={({ isActive }) => cx(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] transition",
                  isActive && !(n.children && loc.search) ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink/80 hover:bg-soft",
                  n.special && "mt-1 border border-violet-500/20 bg-gradient-to-r from-fuchsia-500/5 to-violet-500/10",
                )}>
                  <n.icon className={cx("h-[18px] w-[18px]", n.special && "text-violet-600")} />
                  <span className="flex-1">{n.label}</span>
                  {count ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{count}</span> : null}
                </NavLink>
                {n.children?.map((c) => (
                  <NavLink key={c.to} to={c.to} className={() => cx("ml-4 flex items-center gap-3 rounded-xl px-3 py-1.5 text-[13.5px] transition", here === c.to ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink/70 hover:bg-soft")}>
                    <c.icon className="h-4 w-4" /><span>{c.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      <div className="mt-auto space-y-2 rounded-xl border border-line p-3 text-xs text-muted">
        <ModeRow label="Jev (System One)" on={sys?.jev?.enabled} offText="heuristic" />
        <ModeRow label="Claude (LLM)" on={sys?.llm?.enabled} offText="sandbox" />
        <NavLink to="/ads/integrations"><ModeRow label="Nền tảng" on={(sys?.connections?.live ?? 0) > 0} onText={`${sys?.connections?.live ?? 0} LIVE`} offText={sys?.connections?.sandbox ? "mô phỏng" : "chưa kết nối"} /></NavLink>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card lg:flex">
        <Brand />
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-72 flex-col bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3"><Brand /><button onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-card px-4 md:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Mở menu"><Menu className="h-5 w-5" /></button>
          <div className="hidden items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm font-medium sm:flex">🏢 {sys?.biz?.name ?? ""}<ChevronDown className="h-4 w-4 text-muted" /></div>
          <div className="flex-1" />
          {!standalone && installEvt && <Button size="sm" icon={MonitorCog} onClick={async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => null); setInstallEvt(null); }}>Mở như app</Button>}
          <Button variant={killed ? "danger" : "secondary"} size="sm" icon={Octagon} onClick={() => setKillOpen(true)}>{killed ? "Đang dừng khẩn cấp" : "Dừng khẩn cấp"}</Button>
          <button onClick={() => setDark(!dark)} className="rounded-lg p-2 text-muted hover:bg-soft" aria-label="Đổi giao diện sáng/tối">{dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
          <div className="relative">
            <button onClick={() => setShowNotes(!showNotes)} className="relative rounded-lg p-2 text-muted hover:bg-soft" aria-label="Thông báo">
              <Bell className="h-5 w-5" />
              {notes.length > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] text-white">{notes.length}</span>}
            </button>
            {showNotes && (
              <div className="absolute right-0 top-11 z-30 w-80 rounded-2xl border border-line bg-card p-2 shadow-xl">
                <p className="px-2 py-1 text-sm font-semibold">Thông báo thời gian thực</p>
                {notes.length === 0 ? <p className="px-2 py-3 text-sm text-muted">Chưa có sự kiện mới.</p> : notes.map((n, i) => (
                  <div key={i} className="rounded-lg px-2 py-2 text-sm hover:bg-soft"><p className={n.level === "urgent" ? "text-rose-600" : ""}>{n.text}</p><p className="text-xs text-muted">{timeAgo(n.at)}</p></div>
                ))}
              </div>
            )}
          </div>
          <AccountMenu profile={sys?.profile} canLogout={false} onLogout={() => {}} />
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 scroll-thin">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>

      <Modal open={killOpen} onClose={() => setKillOpen(false)} title="Nút dừng khẩn cấp (kill switch)">
        <p className="mb-4 text-sm text-muted">Dừng ngay mọi tác động ra ngoài của nhóm tương ứng. Việc đang xếp hàng sẽ bị chặn; Sếp mở lại bất cứ lúc nào.</p>
        <div className="space-y-2">
          {[["publish", "Đăng bài"], ["ads", "Quảng cáo (không chặn thao tác TẮT ads)"], ["chat", "Chat bot (chuyển hết sang người)"], ["all", "Toàn hệ thống"]].map(([k, l]) => (
            <div key={k} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <span className="text-sm font-medium">{l}</span>
              <Button size="sm" variant={sys?.killSwitch?.[k] ? "success" : "danger"} onClick={() => setKill(k, !sys?.killSwitch?.[k])}>{sys?.killSwitch?.[k] ? "Mở lại" : "Dừng"}</Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-2 px-5">
      <Sparkles className="h-6 w-6 text-violet-600" />
      <span className="text-xl font-bold tracking-tight">Agentic AI</span>
    </div>
  );
}
function ModeRow({ label, on, offText, onText = "LIVE" }: { label: string; on?: boolean; offText: string; onText?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={cx("rounded-full px-2 py-0.5 font-medium", on ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>{on ? onText : offText}</span>
    </div>
  );
}
