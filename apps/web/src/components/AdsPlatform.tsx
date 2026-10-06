import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PlugZap } from "lucide-react";
import { useApi } from "../lib/api";
import { PlatformIcon, cx } from "./ui";

/**
 * AI Agent Ads chia theo nền tảng: mọi trang set quảng cáo / tối ưu / báo cáo dùng chung `?pf=` (meta | tiktok | google_ads,
 * báo cáo thêm "all"). Nhớ lựa chọn gần nhất trong trình duyệt. Nền tảng chưa kết nối → nói rõ, không hiện số giả.
 */
export type AdsPf = "meta" | "tiktok" | "google_ads";
export type AdsPfOrAll = AdsPf | "all";
export const PLATFORMS: { key: AdsPf; label: string; color: string }[] = [
  { key: "meta", label: "Facebook", color: "#1877F2" },
  { key: "tiktok", label: "TikTok", color: "#111111" },
  { key: "google_ads", label: "Google", color: "#FBBC04" },
];
export const pfLabel = (p: string) => (p === "all" ? "Tất cả nền tảng" : PLATFORMS.find((x) => x.key === p)?.label ?? p);
const KEY = "ads.pf";
const valid = (v: string | null, allowAll: boolean): v is AdsPfOrAll => !!v && (PLATFORMS.some((p) => p.key === v) || (allowAll && v === "all"));

/** Nền tảng đang chọn (URL ?pf= → lần chọn trước → mặc định). Đổi nền tảng giữ nguyên các tham số khác trên URL. */
export function useAdsPlatform(allowAll = false, fallback: AdsPfOrAll = allowAll ? "all" : "meta"): [AdsPfOrAll, (p: AdsPfOrAll) => void] {
  const [params, setParams] = useSearchParams();
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  const fromUrl = params.get("pf");
  const pf: AdsPfOrAll = valid(fromUrl, allowAll) ? fromUrl : valid(stored, allowAll) ? stored : fallback;
  useEffect(() => { if (pf !== "all") try { localStorage.setItem(KEY, pf); } catch { /* ignore */ } }, [pf]);
  const set = (p: AdsPfOrAll) => setParams((cur) => { const n = new URLSearchParams(cur); n.set("pf", p); return n; });
  return [pf, set];
}

/** Tài khoản quảng cáo đã nối theo nền tảng (live / tổng). */
export function usePlatformStatus() {
  const { data } = useApi<any>("automation-options", ["metrics.", "alert."]);
  const accounts = (data?.adAccounts ?? []) as { platform: string; mode: string | null }[];
  const of = (p: AdsPf) => ({ total: accounts.filter((a) => a.platform === p).length, live: accounts.filter((a) => a.platform === p && a.mode === "live").length });
  return { loaded: !!data, of };
}

export function PlatformTabs({ value, onChange, allowAll = false, className }: { value: AdsPfOrAll; onChange: (p: AdsPfOrAll) => void; allowAll?: boolean; className?: string }) {
  const st = usePlatformStatus();
  const tabs: { key: AdsPfOrAll; label: string }[] = [...(allowAll ? [{ key: "all" as const, label: "Tổng tất cả nền tảng" }] : []), ...PLATFORMS];
  return (
    <div className={cx("flex flex-wrap gap-2", className)} role="tablist" aria-label="Nền tảng quảng cáo">
      {tabs.map((t) => {
        const on = value === t.key;
        const s = t.key === "all" ? null : st.of(t.key);
        return (
          <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={cx("flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition", on ? "border-blue-400 bg-blue-500/10 font-semibold text-blue-700 ring-2 ring-blue-500/15 dark:text-blue-300" : "border-line text-ink hover:bg-soft")}>
            {t.key === "all" ? <span className="flex -space-x-1.5">{PLATFORMS.map((p) => <PlatformIcon key={p.key} p={p.key === "meta" ? "facebook" : p.key} size={18} />)}</span> : <PlatformIcon p={t.key === "meta" ? "facebook" : t.key} size={20} />}
            {t.label}
            {s && st.loaded && <span title={s.live ? `${s.live} tài khoản đang kết nối` : "Chưa kết nối tài khoản"} className={cx("h-2 w-2 rounded-full", s.live ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600")} />}
          </button>
        );
      })}
    </div>
  );
}

/** Nền tảng chưa sẵn sàng cho việc này: nói rõ vì sao + việc cần làm (không hiện số / nút giả). */
export function PlatformNotReady({ pf, what }: { pf: AdsPf; what: string }) {
  const st = usePlatformStatus().of(pf);
  const name = pfLabel(pf);
  const msg = pf === "google_ads"
    ? `Hệ thống chưa có bộ kết nối Google Ads (đang trong danh sách "sắp có" ở Trung tâm tích hợp), nên chưa ${what} cho Google được. Khi có kết nối, mục này dùng chung giao diện với Facebook và TikTok.`
    : !st.live
      ? `Chưa kết nối tài khoản ${name} Ads nào, nên chưa ${what} cho ${name} được. Kết nối ở Trung tâm tích hợp, rồi quay lại đây.`
      : `${name}: hệ thống đã đọc được số liệu, nhưng việc ${what} qua API cho ${name} chưa có — làm trực tiếp trên trình quản lý quảng cáo của ${name}.`;
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-soft"><PlatformIcon p={pf} size={34} /></span>
      <p className="text-lg font-semibold text-ink">{name} — chưa sẵn sàng</p>
      <p className="max-w-xl text-sm text-muted">{msg}</p>
      {pf !== "google_ads" && !st.live && <Link to={`/ads/integrations?p=${pf}`} className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"><PlugZap className="h-4 w-4" />Kết nối {name}</Link>}
    </div>
  );
}
