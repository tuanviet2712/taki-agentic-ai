import { useState } from "react";
import { CheckCircle2, PlugZap, Terminal } from "lucide-react";
import { api, useApi } from "../lib/api";
import { Badge, Button, Loading, cx, inputCls, useToast } from "./ui";

const PROVIDERS = [
  { id: "claude_cli", label: "Tài khoản Claude (Claude Code CLI)", hint: "Dùng gói Claude Sếp đang đăng nhập trên máy — không cần API key. Chạy lệnh `claude` ở chế độ nền." },
  { id: "sandbox", label: "Sandbox (không gọi AI)", hint: "Bản nháp mẫu theo DNA — dùng để thử quy trình." },
] as const;
const TIERS = [
  { key: "small", label: "Tầng nhỏ", use: "Chat khách, tóm tắt chuyển người" },
  { key: "medium", label: "Tầng vừa", use: "Brief, bài viết, kịch bản video, SEO" },
  { key: "large", label: "Tầng lớn", use: "Nghiên cứu thị trường, chiến lược" },
] as const;

/** Provider + model-per-tier selection, used on the Settings page. */
export function LlmPanel() {
  const { data, reload, setData } = useApi<any>("llm");
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const toast = useToast();
  if (!data) return <Loading />;
  const s = data.settings;

  const save = async (patch: any, msg: string) => {
    try {
      const r = await api.put("llm", patch);
      setData({ ...data, settings: r.settings, effective: r.effective });
      toast(msg);
    } catch (e: any) { toast(e.message, "err"); reload(); }
  };
  const test = async (model: string) => {
    setTesting(model);
    try {
      const r = await api.post("llm/test", { model });
      setResults((x) => ({ ...x, [model]: r }));
      toast(r.ok ? `${model} trả lời sau ${(r.latencyMs / 1000).toFixed(1)}s` : `Lỗi: ${r.reason}`, r.ok ? "ok" : "err");
    } finally { setTesting(null); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-3">
        {PROVIDERS.map((p) => {
          const active = s.provider === p.id;
          return (
            <button key={p.id} onClick={() => !active && save({ provider: p.id }, `Đã chuyển sang: ${p.label}`)} className={cx("rounded-xl border p-3 text-left transition", active ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:bg-soft")}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">{active && <CheckCircle2 className="h-4 w-4 text-blue-600" />}{p.label}</p>
              <p className="mt-1 text-xs text-muted">{p.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-soft p-3 text-xs">
        <Terminal className="h-4 w-4 text-muted" />
        <span>Claude CLI: {data.cli.available ? <Badge tone={data.cli.loggedIn === false ? "red" : data.cli.loggedIn === null ? "amber" : "green"}>{data.cli.version}</Badge> : <Badge tone="red">không tìm thấy lệnh `claude`</Badge>}</span>
        <span>· Đang dùng thực tế: <Badge tone={data.effective.provider === "sandbox" ? "amber" : "green"}>{PROVIDERS.find((p) => p.id === data.effective.provider)?.label}</Badge></span>
        {data.effective.reason && <span className="text-amber-600">({data.effective.reason})</span>}
        {data.cli.loggedIn === false && <span className="w-full text-rose-600">Hết phiên đăng nhập — mở Terminal, gõ <code className="rounded bg-white/60 px-1">claude</code> rồi <code className="rounded bg-white/60 px-1">/login</code>.{data.cli.authError ? ` (${data.cli.authError})` : ""}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-2">Tầng</th><th>Dùng cho</th><th>Model</th><th className="text-right">Kiểm tra</th></tr></thead>
          <tbody className="divide-y divide-line">
            {TIERS.map((t) => {
              const model = s.models[t.key];
              const r = results[model];
              return (
                <tr key={t.key}>
                  <td className="py-2.5 font-medium">{t.label}</td>
                  <td className="text-xs text-muted">{t.use}</td>
                  <td className="py-2">
                    <select className={cx(inputCls, "py-1.5 text-sm")} value={model} onChange={(e) => save({ models: { [t.key]: e.target.value } }, `${t.label} → ${e.target.value}`)}>
                      {data.catalog.map((m: any) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}
                    </select>
                  </td>
                  <td className="text-right">
                    <Button size="sm" icon={PlugZap} loading={testing === model} disabled={data.effective.provider === "sandbox"} onClick={() => test(model)}>Thử</Button>
                    {r && <p className={cx("mt-1 text-[11px]", r.ok ? "text-emerald-600" : "text-rose-600")}>{r.ok ? `OK · ${(r.latencyMs / 1000).toFixed(1)}s` : "Lỗi"}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">Mức suy nghĩ (effort):</span>
        {(["low", "medium", "high"] as const).map((e) => (
          <button key={e} onClick={() => save({ effort: e }, `Effort: ${e}`)} className={cx("rounded-full px-3 py-1 text-xs", s.effort === e ? "bg-blue-600 text-white" : "bg-soft text-ink hover:bg-line")}>{e === "low" ? "Thấp (nhanh)" : e === "medium" ? "Vừa" : "Cao (kỹ hơn)"}</button>
        ))}
      </div>
      <p className="text-xs text-muted">Có thể chọn model riêng cho từng agent ở trang Agent & Tác vụ. Khi dùng tài khoản Claude, các lượt gọi tính vào hạn mức sử dụng của gói; con số "chi phí" hiển thị chỉ là giá trị quy đổi để so sánh.</p>
    </div>
  );
}
