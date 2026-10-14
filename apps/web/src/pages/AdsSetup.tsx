import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Bot, OctagonX, Save, ShieldCheck, Wallet } from "lucide-react";
import { api, useApi } from "../lib/api";
import { vndFull } from "../lib/format";
import { Badge, Button, Card, Field, Loading, PageHeader, Toggle, cx, inputCls, useToast } from "../components/ui";

const AUTONOMY: [string, string, string][] = [
  ["L0", "Chỉ gợi ý", "Luồng LIVE chỉ ghi đề xuất, không tạo việc cần làm."],
  ["L1", "Chờ Sếp duyệt", "Luồng LIVE tạo mục trong Duyệt & Phê duyệt; bấm duyệt mới thực hiện. (Khuyến nghị)"],
  ["L2", "Tự làm trong trần", "Luồng LIVE tự tắt ads/đổi ngân sách trong trần an toàn, báo cáo sau."],
  ["L3", "Tự động hoàn toàn", "Như L2, dành cho tài khoản đã chạy ổn định nhiều tuần."],
];

/** "Thiết lập" of the AI Agent Ads workspace: caps, Ads Agent autonomy, kill switch, alerts, whitelist. */
export function AdsSetup() {
  const toast = useToast();
  const { data, reload } = useApi<any>("settings", ["alert."]);
  const { data: agents, reload: reloadAgents } = useApi<any[]>("agents");
  const { data: sum } = useApi<any>("ads-agent/summary");
  const { data: wl } = useApi<any>("whitelist");
  const [caps, setCaps] = useState({ maxTotalDailyAdBudget: 0, maxAdsCreatedPerDay: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data) setCaps({ maxTotalDailyAdBudget: data.settings.caps.maxTotalDailyAdBudget, maxAdsCreatedPerDay: data.settings.caps.maxAdsCreatedPerDay }); }, [data]);
  const ads = agents?.find((a) => a.key === "ads");
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); reload(); reloadAgents(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  if (!data) return <Loading />;
  const killed = !!data.settings.killSwitch?.ads || !!data.settings.killSwitch?.all;

  return (
    <div className="space-y-6">
      <PageHeader title="Thiết lập" subtitle="Giới hạn an toàn, mức tự chủ của Ads Agent, dừng khẩn cấp và kênh cảnh báo cho toàn bộ luồng quảng cáo." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-blue-600" />Giới hạn an toàn</span>}
          action={<Button size="sm" variant="primary" icon={Save} loading={busy === "caps"} onClick={() => run("caps", () => api.put("settings", { caps: { maxTotalDailyAdBudget: Number(caps.maxTotalDailyAdBudget), maxAdsCreatedPerDay: Number(caps.maxAdsCreatedPerDay) } }), "Đã lưu giới hạn")}>Lưu</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tổng ngân sách tối đa/ngày (VNĐ)" hint={vndFull(Number(caps.maxTotalDailyAdBudget))}><input type="number" step={1_000_000} className={inputCls} value={caps.maxTotalDailyAdBudget} onChange={(e) => setCaps({ ...caps, maxTotalDailyAdBudget: Number(e.target.value) })} /></Field>
            <Field label="Số quảng cáo tạo mới tối đa/ngày"><input type="number" min={0} className={inputCls} value={caps.maxAdsCreatedPerDay} onChange={(e) => setCaps({ ...caps, maxAdsCreatedPerDay: Number(e.target.value) })} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted">Mọi luồng tăng ngân sách, tạo chiến dịch nhanh và khóa AI đều bị chặn khi vượt các trần này.</p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-blue-600" />Mức tự chủ của Ads Agent</span>}>
          {!ads ? <Loading /> : (
            <div className="space-y-2">
              {AUTONOMY.map(([k, t, d]) => (
                <button key={k} disabled={busy === "auto"} onClick={() => run("auto", () => api.put("agents/ads/config", { autonomy: k }), `Ads Agent: ${k} · ${t}`)} className={cx("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition", ads.config?.autonomy === k ? "border-blue-500 bg-blue-500/10" : "border-line hover:bg-soft")}>
                  <Badge tone={ads.config?.autonomy === k ? "blue" : "gray"}>{k}</Badge>
                  <span><span className="block text-sm font-medium text-ink">{t}</span><span className="text-xs text-muted">{d}</span></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><OctagonX className="h-4 w-4 text-rose-500" />Dừng khẩn cấp quảng cáo</span>}>
          <div className={cx("flex items-center justify-between gap-3 rounded-xl border p-4", killed ? "border-rose-500/40 bg-rose-500/10" : "border-line")}>
            <div><p className="font-medium text-ink">{killed ? "Đang DỪNG mọi thay đổi quảng cáo" : "Đang hoạt động bình thường"}</p><p className="text-xs text-muted">Khi bật: không tạo/sửa/tăng ngân sách. Thao tác TẮT ads vẫn được phép để cắt lỗ.</p></div>
            <Toggle checked={!!data.settings.killSwitch?.ads} disabled={busy === "kill"} onChange={(v) => run("kill", () => api.post("kill-switch", { area: "ads", on: v }), v ? "Đã DỪNG khẩn cấp quảng cáo" : "Đã mở lại quảng cáo")} />
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4 text-blue-600" />Cảnh báo & whitelist</span>}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
              <span><b className="text-ink">Telegram</b><span className="block text-xs text-muted">Nhận cảnh báo khi luồng tắt ads, đổi ngân sách, báo cáo sáng</span></span>
              {sum?.telegram ? <Button size="sm" loading={busy === "tg"} onClick={() => run("tg", () => api.post("notify/test"), "Đã gửi tin nhắn thử")}>Gửi tin thử</Button> : <Link to="/ads/integrations?p=telegram"><Button size="sm" variant="primary">Liên kết Telegram</Button></Link>}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
              <span className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" /><span><b className="text-ink">Whitelist</b><span className="block text-xs text-muted">{wl ? `${wl.adAccounts.filter((a: any) => a.whitelisted).length}/${wl.adAccounts.length} tài khoản QC · ${wl.pages.filter((p: any) => p.whitelisted).length}/${wl.pages.length} Fanpage được phép tự động hoá` : "…"}</span></span></span>
              <Link to="/ads/integrations?p=whitelist"><Button size="sm">Quản lý</Button></Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
