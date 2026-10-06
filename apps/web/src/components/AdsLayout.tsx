import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Bell, CalendarDays, ChartColumn, ChartNoAxesColumn, ChevronDown, CircleHelp, CirclePause, FileText, History,
  Megaphone, MessageSquare, ThumbsUp, Moon, Music2, PieChart as PieChartIcon, Puzzle, RefreshCw, Rocket, Search, Settings, Sparkles, Sun, X,
} from "lucide-react";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { Avatar, cx } from "./ui";
import { AccountMenu } from "./Account";

/**
 * "AI Agent Ads" workspace shell: own header, grouped top navigation, announcement banner and footer,
 * with a violet accent (.ads-theme). Pages inside reuse the same components as the rest of the system.
 */
type Item = { to: string; label: string; icon: any; match?: (path: string, search: string) => boolean };
const rep = (pf: string) => (p: string, s: string) => p === "/ads/reports" && (new URLSearchParams(s).get("pf") ?? "all") === pf;
export const ADS_NAV: { title: string; items: Item[] }[] = [
  { title: "Vận hành", items: [
    { to: "/ads/setup", label: "Thiết lập", icon: Settings },
    { to: "/ads/flows?type=metrics_pull", label: "Đồng bộ dữ liệu", icon: RefreshCw, match: (p, s) => p === "/ads/flows" && (s.includes("metrics_pull") || !s.includes("type=")) },
  ] },
  // Set quảng cáo + Tối ưu: mỗi trang có thanh chọn Facebook / TikTok / Google (?pf=)
  { title: "Set quảng cáo", items: [
    { to: "/ads/quick", label: "Tạo chiến dịch", icon: Rocket },
    { to: "/ads/library", label: "Thư viện nội dung", icon: FileText },
  ] },
  { title: "Tối ưu quảng cáo", items: [
    { to: "/ads/stats", label: "Quảng cáo đang chạy", icon: ChartColumn },
    { to: "/ads/flows?type=auto_off", label: "Dừng theo điều kiện", icon: CirclePause, match: (p, s) => p === "/ads/flows" && s.includes("auto_off") },
    { to: "/ads/flows?type=budget", label: "Điều chỉnh chi tiêu", icon: ChartNoAxesColumn, match: (p, s) => p === "/ads/flows" && s.includes("budget") },
    { to: "/ads/flows?type=auto_run", label: "Khởi chạy theo lịch", icon: CalendarDays, match: (p, s) => p === "/ads/flows" && s.includes("auto_run") },
  ] },
  { title: "Báo cáo", items: [
    { to: "/ads/reports?pf=all", label: "Báo cáo tổng", icon: PieChartIcon, match: rep("all") },
    { to: "/ads/reports?pf=meta", label: "Facebook", icon: ThumbsUp, match: rep("meta") },
    { to: "/ads/reports?pf=tiktok", label: "TikTok", icon: Music2, match: rep("tiktok") },
    { to: "/ads/reports?pf=google_ads", label: "Google", icon: Search, match: rep("google_ads") },
  ] },
  { title: "Hạ tầng", items: [
    { to: "/ads/integrations", label: "Trung tâm tích hợp", icon: Puzzle },
    { to: "/ads/logs", label: "Lịch sử hoạt động", icon: History },
    { to: "/ads/ai-gateway", label: "Cổng AI", icon: Sparkles, match: (p) => p.startsWith("/ads/ai-gateway") },
    { to: "/ads/help", label: "Trợ giúp", icon: CircleHelp },
  ] },
];

function useDark(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("theme") === "dark"; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  return [dark, setDark];
}

export function AdsLayout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { data: sys } = useApi<any>("system", ["approval.", "alert."]);
  const { data: sum } = useApi<any>("ads-agent/summary", ["approval.", "action.", "automation.", "alert."]);
  const [dark, setDark] = useDark();
  const [banner, setBanner] = useState(() => { try { return localStorage.getItem("ads.banner") !== "off"; } catch { return true; } });
  const [menu, setMenu] = useState<"space" | "user" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => setMenu(null), [loc.pathname, loc.search]);
  const isActive = (it: Item) => (it.match ? it.match(loc.pathname, loc.search) : loc.pathname === it.to.split("?")[0]);
  const hideBanner = () => { setBanner(false); try { localStorage.setItem("ads.banner", "off"); } catch { /* ignore */ } };

  return (
    <div className="ads-theme flex h-full flex-col" ref={menuRef}>
      <header className="shrink-0 border-b border-line bg-card">
        <div className="flex h-16 items-center gap-3 px-4 md:px-8">
          <Link to="/ads/flows" className="whitespace-nowrap text-xl font-bold tracking-tight text-ink md:text-2xl">AI Agent Ads</Link>
          <div className="relative ml-2 hidden sm:block">
            <button onClick={() => setMenu(menu === "space" ? null : "space")} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:bg-soft">
              <span className="text-muted">Không gian:</span><span className="font-semibold text-ink">{sys?.biz?.name ?? "…"}</span><ChevronDown className="h-4 w-4 text-muted" />
            </button>
            {menu === "space" && (
              <div className="absolute left-0 top-12 z-40 w-72 rounded-2xl border border-line bg-card p-2 shadow-xl">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Không gian làm việc</p>
                <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300">✓ {sys?.biz?.name}</div>
                <Link to="/" className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink hover:bg-soft"><ArrowLeft className="h-4 w-4" />Về hệ thống Agentic AI</Link>
              </div>
            )}
          </div>
          <Link to="/ads/setup" className="hidden rounded-xl border border-line p-2 text-muted hover:bg-soft sm:block" aria-label="Thiết lập"><Settings className="h-5 w-5" /></Link>
          <div className="flex-1" />
          <Link to="/approvals" className="relative rounded-lg p-2 text-muted hover:bg-soft" aria-label="Mục chờ duyệt" title="Mục quảng cáo chờ duyệt">
            <Bell className="h-5 w-5" />
            {sum?.pendingAds ? <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] text-white">{sum.pendingAds}</span> : <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 opacity-0" />}
          </Link>
          <div className="flex items-center gap-1.5">
            <Sun className={cx("h-4 w-4", dark ? "text-muted" : "text-amber-500")} />
            <button role="switch" aria-checked={dark} aria-label="Đổi giao diện sáng/tối" onClick={() => setDark(!dark)} className={cx("relative h-6 w-11 rounded-full transition", dark ? "bg-blue-600" : "bg-blue-200")}>
              <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", dark ? "left-[22px]" : "left-0.5")} />
            </button>
            <Moon className={cx("h-4 w-4", dark ? "text-blue-400" : "text-muted")} />
          </div>
          <AccountMenu profile={sys?.profile} canLogout={false} onLogout={() => {}}
            extra={(close) => <Link to="/" onClick={close} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-soft"><ArrowLeft className="h-4 w-4" />Về hệ thống Agentic AI</Link>} />
        </div>
        <nav className="flex gap-0 overflow-x-auto px-2 pb-2 scroll-thin md:px-6">
          {ADS_NAV.map((g, gi) => (
            <div key={g.title} className={cx("shrink-0 px-1", gi > 0 && "ml-1 border-l border-line pl-2")}>
              <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{g.title}</p>
              <div className="flex gap-1">
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} className={() => cx("flex items-center gap-1.5 rounded-xl px-2 py-2 text-[13.5px] leading-tight transition",
                    isActive(it) ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink/85 hover:bg-soft")}>
                    <it.icon className="h-5 w-5 shrink-0" /><span className="max-w-[88px]">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto scroll-thin">
        {banner && (
          <div className="mx-4 mt-4 flex items-center justify-center gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 px-4 py-2.5 text-sm dark:border-orange-500/20 dark:from-orange-500/10 dark:via-amber-500/5 dark:to-orange-500/10 md:mx-8">
            <Megaphone className="h-5 w-5 shrink-0 text-orange-500" />
            <span className="font-medium text-ink">AI Agent Ads — kết nối nền tảng thật, luồng tự động chạy thử trước khi LIVE</span>
            <span className="hidden rounded-full bg-amber-200/70 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 sm:inline">Bản thử nghiệm v1</span>
            <button onClick={hideBanner} className="ml-auto rounded-lg p-1 text-muted hover:bg-white/50" aria-label="Ẩn thông báo"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="mx-auto max-w-[1480px] p-4 md:p-8">{children}</div>
      </main>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-card px-4 py-3 text-sm md:px-8">
        <span className="flex items-center gap-2"><Avatar name={sys?.operator ?? "TAKI"} size={30} /><b className="text-ink">{sys?.operator}</b><span className="hidden text-muted md:inline">· CEO {sys?.ceo}</span></span>
        <span className="hidden h-5 border-l border-line md:block" />
        <span className="flex items-center gap-1.5 text-muted"><ArrowDownToLine className="h-4 w-4" />Token đầu vào hôm nay: <b className="text-blue-600">{sum ? num(sum.tokensIn) : "--"}</b></span>
        <span className="flex items-center gap-1.5 text-muted"><ArrowUpFromLine className="h-4 w-4" />Token đầu ra: <b className="text-blue-600">{sum ? num(sum.tokensOut) : "--"}</b></span>
        <span className="flex-1" />
        <Link to="/ads/help" className="flex items-center gap-1.5 text-muted hover:text-ink"><MessageSquare className="h-4 w-4" />Gửi phản hồi</Link>
      </footer>
    </div>
  );
}
