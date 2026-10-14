import { useState } from "react";
import { AlertTriangle, CircleAlert, Copy, History, KeyRound, Layers, Plus, Shield, Star, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, cx, inputCls, useToast } from "../components/ui";
import { PlatformTileIcon } from "./Connections";

const COLORS: Record<string, string> = { meta: "#1877F2", pancake: "#1DA1F2", nhanh: "#E11D48", tiktok: "#111111", agentic: "#7C3AED" };
const EXPIRY = [[7, "7 ngày"], [30, "30 ngày"], [90, "90 ngày"], [365, "1 năm"], [0, "Không hết hạn"]] as const;
const snippetFor = (dir: string, key = "<dán key vào đây>") => `{\n  "mcpServers": {\n    "taki-agentic": {\n      "command": "pnpm",\n      "args": ["--dir", "${dir}", "mcp"],\n      "env": { "MCP_KEY": "${key}" }\n    }\n  }\n}`;

export function Mcp() {
  const toast = useToast();
  const { data, reload } = useApi<any>("mcp-keys");
  const nav = useNavigate();
  const [revoke, setRevoke] = useState<any | null>(null);
  const [calls, setCalls] = useState<{ k: any; list: any[] } | null>(null);
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Đã sao chép"), () => toast("Không sao chép được — hãy bôi đen và copy", "err"));
  const dir = data?.projectDir ?? "dotaka-agentic";
  const snippet = (key?: string) => snippetFor(dir, key);
  const scopeName = (p: string) => data?.scopes?.find((s: any) => s.platform === p);

  return (
    <div className="space-y-6">
      <PageHeader title="Cổng AI" subtitle="Cấp khóa để Claude Desktop, Cursor, n8n… đọc/điều khiển hệ thống qua MCP, phân quyền theo từng nền tảng."
        actions={<Button variant="primary" icon={KeyRound} className="h-12 px-6 text-base" onClick={() => nav("/ads/ai-gateway/new")}>Tạo khóa</Button>} />

      <Card title="Khóa đã cấp">
        {!data ? <Loading /> : data.keys.length === 0 ? <Empty>Chưa có khóa nào. Bấm “Tạo khóa” để cấp khóa đầu tiên.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Tên khóa", "Phạm vi truy cập", "Hiệu lực đến", "Sử dụng", "Trạng thái", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {data.keys.map((k: any) => {
                  const expired = k.expires_at && new Date(k.expires_at) < new Date();
                  const p = k.permissions ?? {};
                  return (
                    <tr key={k.id} className="align-top">
                      <td className="px-2 py-3"><p className="font-medium text-ink">{k.name}</p><p className="font-mono text-xs text-muted">mcp_…{k.key_last4}</p></td>
                      <td className="px-2 py-3">
                        {p.all ? <Badge tone="red"><Star className="h-3 w-3" />Toàn quyền</Badge> : p.scopes ? (
                          <div className="flex flex-wrap gap-1">{Object.entries(p.scopes).map(([pl, perms]: any) => <Badge key={pl} tone={perms.some((x: string) => x === "write" || x === "create") ? "amber" : "blue"}>{scopeName(pl)?.name ?? pl}: {perms.map((x: string) => scopeName(pl)?.perms.find((y: any) => y.key === x)?.label ?? x).join(", ")}</Badge>)}</div>
                        ) : <Badge tone={p.write ? "amber" : "blue"}>{p.write ? "Đọc + ghi (key cũ)" : "Chỉ đọc (key cũ)"}</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-xs text-muted">{k.expires_at ? ddmm(k.expires_at) : "Không hết hạn"}</td>
                      <td className="px-2 py-3 text-xs text-muted">{k.calls} lượt{k.lastUsed ? ` · ${timeAgo(k.lastUsed)}` : ""}</td>
                      <td className="px-2 py-3">{k.revoked_at ? <Badge tone="gray">Đã thu hồi</Badge> : expired ? <Badge tone="gray">Hết hạn</Badge> : <Badge tone="green">Hoạt động</Badge>}</td>
                      <td className="px-2 py-3 text-right"><span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" icon={History} onClick={async () => setCalls({ k, list: await api.get(`mcp-keys/${k.id}/calls`) })} aria-label="Lịch sử gọi" />
                        {!k.revoked_at && !expired && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRevoke(k)}>Thu hồi</Button>}
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Cách kết nối">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Tạo key với đúng quyền cần dùng (nên bắt đầu bằng quyền Xem).</li>
          <li>Dán cấu hình dưới vào Claude Desktop (Settings → Developer → Edit Config) hoặc Cursor (<code className="rounded bg-soft px-1">~/.cursor/mcp.json</code>).</li>
          <li>Khởi động lại ứng dụng — hỏi thử: "Liệt kê quảng cáo đang chạy và CPA 7 ngày".</li>
        </ol>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{snippet()}</pre>
        <p className="mt-2 text-xs text-muted">Thao tác ghi (tắt ads, đổi ngân sách) luôn trả bản xem trước trước, cần gọi lại với confirm=true, và vẫn đi qua trần ngân sách, whitelist, cooldown, nút Dừng khẩn cấp.</p>
      </Card>

      <Modal open={!!revoke} onClose={() => setRevoke(null)} title="Thu hồi key?"
        footer={<><Button onClick={() => setRevoke(null)}>Hủy</Button><Button variant="danger" onClick={async () => { try { await api.del(`mcp-keys/${revoke.id}`); toast("Đã thu hồi key"); setRevoke(null); reload(); } catch (e: any) { toast(e.message, "err"); } }}>Thu hồi</Button></>}>
        {revoke && <p className="text-sm text-muted">Mọi ứng dụng đang dùng key <b className="text-ink">{revoke.name}</b> sẽ mất quyền truy cập ngay lập tức.</p>}
      </Modal>

      <Modal open={!!calls} onClose={() => setCalls(null)} title={calls ? `Lượt gọi — ${calls.k.name}` : ""} footer={<Button onClick={() => setCalls(null)}>Đóng</Button>}>
        {calls && (calls.list.length === 0 ? <Empty>Chưa có lượt gọi.</Empty> : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto scroll-thin">{calls.list.map((c, i) => (
            <div key={i} className="rounded-xl border border-line p-3 text-xs"><p className="flex justify-between"><code className="text-ink">{c.tool}</code><span className="text-muted">{ddmm(c.at)} {hhmm(c.at)}</span></p><p className="mt-1 truncate text-muted">{JSON.stringify(c.params)}</p></div>
          ))}</div>
        ))}
      </Modal>
    </div>
  );
}

/** Full-page "Cấp khóa kết nối AI" (Cổng AI / Khóa mới). */
export function McpNewKey() {
  const toast = useToast();
  const nav = useNavigate();
  const { data } = useApi<any>("mcp-keys");
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [all, setAll] = useState(false);
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState<any | null>(null);
  const scopes: any[] = data?.scopes ?? [];
  const toggle = (p: string, k: string) => setSel((s) => ({ ...s, [p]: (s[p] ?? []).includes(k) ? s[p].filter((x) => x !== k) : [...(s[p] ?? []), k] }));
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Đã sao chép"), () => toast("Không sao chép được — hãy bôi đen và copy", "err"));
  const submit = async () => {
    setBusy(true);
    try { setRaw(await api.post("mcp-keys", { name, all, scopes: all ? {} : sel, days: days || null })); }
    catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted"><Link to="/ads/ai-gateway" className="hover:text-ink">Cổng AI</Link> <span className="mx-1.5">/</span> Khóa mới</p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-4xl">Cấp khóa kết nối AI</h1>
          <p className="mt-1 text-muted md:text-lg">Kết nối Claude Desktop, Cursor với hệ thống.</p>
        </div>
        <div className="flex gap-3">
          <Button className="h-12 px-7 text-base" onClick={() => nav("/ads/ai-gateway")}>Hủy</Button>
          <Button variant="primary" icon={KeyRound} className="h-12 px-6 text-base" loading={busy} onClick={submit}>Tạo khóa</Button>
        </div>
      </div>

      <div className="grid gap-6 wide:grid-cols-[400px_minmax(0,1fr)]">
        <section className="h-fit rounded-2xl border border-line bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-3 text-xl font-bold text-ink"><KeyRound className="h-6 w-6 text-blue-600" />Thông tin khóa</h2>
          <p className="ml-9 mt-1 text-sm text-muted">Đặt tên và thiết lập thời hạn hiệu lực cho khóa kết nối.</p>
          <div className="mt-6 space-y-5">
            <Field label="Tên khóa"><input className={cx(inputCls, "h-12")} value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: n8n-automation, zapier-sync, claude-agent" /></Field>
            <Field label="Hiệu lực đến"><select className={cx(inputCls, "h-12")} value={days} onChange={(e) => setDays(Number(e.target.value))}>{EXPIRY.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></Field>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-blue-600" checked={all} onChange={(e) => setAll(e.target.checked)} />
              <span><span className="block font-medium text-ink">Cấp toàn bộ quyền</span><span className="text-sm text-muted">Cho phép truy cập tất cả tính năng của mọi nền tảng.</span></span>
            </label>
            <div className="flex gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-ink dark:border-amber-500/30 dark:bg-amber-500/10">
              <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />
              <span>AI có quyền ghi hoặc sửa dữ liệu có thể tác động đến hoạt động kinh doanh. Hãy kiểm tra quyền trước khi cấp khóa. Mọi thao tác ghi vẫn cần xác nhận, qua trần ngân sách và whitelist.</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-3 text-xl font-bold text-ink"><Layers className="h-6 w-6 text-blue-600" />Phạm vi truy cập</h2>
          <p className="ml-9 mt-1 text-sm text-muted">Chọn các nền tảng và quyền truy cập cho khóa này.</p>
          {!data ? <Loading /> : (
            <div className={cx("mt-5 space-y-3", all && "pointer-events-none opacity-60")}>
              {scopes.map((s) => (
                <div key={s.platform} className="flex flex-col gap-3 rounded-2xl border border-line p-4 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 items-center gap-3 lg:w-[250px] lg:shrink-0">
                    <PlatformTileIcon p={{ key: s.platform === "agentic" ? "ai" : s.platform, color: COLORS[s.platform] ?? "#64748b" }} size={40} round />
                    <div className="min-w-0"><p className="font-semibold text-ink">{s.name}</p><p className="text-xs text-muted">{s.desc}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.perms.map((p: any) => {
                      const on = all || (sel[s.platform] ?? []).includes(p.key);
                      return (
                        <label key={p.key} className={cx("flex min-w-[112px] cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition", on ? (p.sensitive ? "border-amber-400 bg-amber-500/10" : "border-blue-400 bg-blue-500/10") : "border-line hover:bg-soft")}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={on} onChange={() => toggle(s.platform, p.key)} />
                          <span className="leading-tight"><span className="flex items-center gap-1 text-sm font-medium text-ink">{p.title}{p.sensitive && <Shield className="h-3.5 w-3.5 fill-current text-muted" />}</span><span className="text-xs text-muted">{p.label}</span></span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Modal open={!!raw} onClose={() => nav("/ads/ai-gateway")} title="Khóa đã tạo — chỉ hiện 1 lần" footer={<Button variant="primary" onClick={() => nav("/ads/ai-gateway")}>Tôi đã lưu khóa</Button>}>
        {raw && (
          <div className="space-y-3 text-sm">
            <div className="flex gap-2"><code className="min-w-0 flex-1 break-all rounded-xl bg-soft p-3 font-mono text-xs text-ink">{raw.key}</code><Button icon={Copy} onClick={() => copy(raw.key)}>Sao chép</Button></div>
            {raw.warning && <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{raw.warning}</p>}
            <p className="text-muted">Cấu hình Claude Desktop / Cursor đã điền sẵn khóa:</p>
            <div className="relative"><pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{snippetFor(data?.projectDir ?? "dotaka-agentic", raw.key)}</pre><Button size="sm" icon={Copy} className="absolute right-2 top-2" onClick={() => copy(snippetFor(data?.projectDir ?? "dotaka-agentic", raw.key))}>Copy</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
