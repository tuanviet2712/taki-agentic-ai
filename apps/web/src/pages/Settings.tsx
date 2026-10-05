import { useEffect, useState } from "react";
import { AlertTriangle, FileClock, Link2, MonitorCog, OctagonX, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { LlmPanel } from "../components/LlmPanel";
import { AccountForm } from "../components/Account";
import { AGENT_LABEL, num, timeAgo, vndFull } from "../lib/format";
import type { Tone } from "../lib/format";
import { Avatar, Badge, Button, Card, Empty, Field, JevBadge, Loading, Modal, PageHeader, PlatformIcon, Toggle, cx, inputCls, useToast } from "../components/ui";

const AUTONOMY: Record<string, string> = {
  L0: "L0 · Chỉ gợi ý, không tự làm",
  L1: "L1 · Soạn nháp, chờ Sếp duyệt",
  L2: "L2 · Tự làm trong trần, báo cáo sau",
  L3: "L3 · Tự động hoàn toàn",
};
const ROLE: Record<string, { label: string; tone: Tone }> = {
  owner: { label: "Chủ sở hữu", tone: "violet" }, buyer: { label: "Chạy quảng cáo", tone: "blue" },
  sales: { label: "Sales tư vấn", tone: "green" }, viewer: { label: "Chỉ xem", tone: "gray" },
};
const KILL: { area: "publish" | "ads" | "chat" | "all"; label: string; desc: string }[] = [
  { area: "publish", label: "Dừng đăng bài", desc: "Không đăng thêm bài nào lên mọi kênh" },
  { area: "ads", label: "Dừng quảng cáo", desc: "Không tạo/sửa/tăng ngân sách quảng cáo" },
  { area: "chat", label: "Dừng bot chat", desc: "Mọi tin nhắn chuyển cho đội sales" },
  { area: "all", label: "Dừng toàn bộ", desc: "Tạm dừng tất cả AI Agent" },
];
const usd = (m?: number | null) => { const v = (m ?? 0) / 1e6; return v === 0 ? "$0" : v < 0.0001 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`; };
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—");

function AgentConfig() {
  const toast = useToast();
  const { data: agents, setData } = useApi<any[]>("agents");
  const [confirm, setConfirm] = useState<{ key: string; from: string; to: string } | null>(null);
  const save = async (key: string, patch: any, msg: string) => {
    try {
      const cfg = await api.put(`agents/${key}/config`, patch);
      setData((xs) => xs?.map((a) => (a.key === key ? { ...a, config: cfg } : a)) ?? null);
      toast(msg);
    } catch (e: any) { toast(e.message, "err"); }
  };
  const changeAutonomy = (a: any, to: string) => {
    const from = a.config?.autonomy ?? a.autonomy;
    if (to > from) setConfirm({ key: a.key, from, to });
    else void save(a.key, { autonomy: to }, `Đã hạ quyền tự chủ ${AGENT_LABEL[a.key] ?? a.label} xuống ${to}`);
  };
  return (
    <Card title="Cấu hình AI Agent">
      {!agents ? <Loading /> : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-3 font-medium">Agent</th><th className="py-2 pr-3 font-medium">Mức tự chủ</th><th className="py-2 pr-3 font-medium">Bật</th><th className="py-2 font-medium">Ngân sách token/ngày</th></tr></thead>
            <tbody className="divide-y divide-line">
              {agents.map((a) => (
                <tr key={a.key}>
                  <td className="py-2.5 pr-3"><p className="font-medium text-ink">{a.label ?? AGENT_LABEL[a.key]}</p><p className="text-xs text-muted">{num(a.tokensToday)} token hôm nay{a.usesJev?.length ? " · dùng Jev" : ""}</p></td>
                  <td className="py-2.5 pr-3">
                    <select className={cx(inputCls, "py-1.5")} value={a.config?.autonomy ?? a.autonomy} onChange={(e) => changeAutonomy(a, e.target.value)}>
                      {Object.entries(AUTONOMY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="py-2.5 pr-3"><Toggle checked={!!a.config?.enabled} onChange={(v) => save(a.key, { enabled: v }, `${v ? "Đã bật" : "Đã tắt"} ${a.label}`)} /></td>
                  <td className="py-2.5">
                    <input type="number" min={1000} step={1000} className={cx(inputCls, "w-36 py-1.5")} defaultValue={a.config?.token_budget_day ?? a.tokenBudgetDay}
                      onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== a.config?.token_budget_day) void save(a.key, { tokenBudgetDay: Math.round(v) }, `Đã lưu ngân sách token cho ${a.label}`); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Tăng quyền tự chủ?"
        footer={<><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="danger" onClick={() => { if (confirm) void save(confirm.key, { autonomy: confirm.to }, `Đã nâng quyền tự chủ lên ${confirm.to}`); setConfirm(null); }}>Xác nhận nâng</Button></>}>
        {confirm && (
          <div className="space-y-3 text-sm text-ink">
            <p><b>{AGENT_LABEL[confirm.key] ?? confirm.key}</b>: {AUTONOMY[confirm.from]} → <b>{AUTONOMY[confirm.to]}</b></p>
            <p className="flex gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />Agent sẽ tự thực hiện nhiều việc hơn mà không cần Sếp duyệt. Trần ngân sách, cooldown và nút dừng khẩn cấp vẫn áp dụng.</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export function Settings() {
  const toast = useToast();
  const { data, reload, setData } = useApi<any>("settings", ["alert."]);
  const { data: sys } = useApi<any>("system");
  const { data: usage } = useApi<any>("usage");
  const { data: users, reload: reloadUsers } = useApi<UserRow[]>("users");
  const [f, setF] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data && !f) { const s = data.settings; setF({ ...s.caps, postScoreThreshold: s.postScoreThreshold, explorationPct: s.explorationPct, approvalExpiryHours: s.approvalExpiryHours, backupPerson: s.backupPerson ?? "" }); }
  }, [data, f]);
  if (!data || !f) return <Loading />;
  const s = data.settings;

  const saveCaps = async () => {
    setSaving(true);
    try {
      await api.put("settings", { caps: { maxTotalDailyAdBudget: Number(f.maxTotalDailyAdBudget), maxAdsCreatedPerDay: Number(f.maxAdsCreatedPerDay), maxPostsPerDayPerChannel: Number(f.maxPostsPerDayPerChannel) }, postScoreThreshold: Number(f.postScoreThreshold), explorationPct: Number(f.explorationPct), approvalExpiryHours: Number(f.approvalExpiryHours), ...(f.backupPerson ? { backupPerson: f.backupPerson } : {}) });
      toast("Đã lưu trần & chính sách"); reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };
  const kill = async (area: string, on: boolean) => {
    try { const ks = await api.post("kill-switch", { area, on }); setData({ ...data, settings: { ...s, killSwitch: ks } }); toast(on ? `Đã BẬT dừng khẩn cấp: ${area}` : `Đã tắt dừng khẩn cấp: ${area}`, on ? "err" : "ok"); }
    catch (e: any) { toast(e.message, "err"); }
  };
  const num2 = (k: string, label: string, hint?: string, extra?: any) => (
    <Field label={label} hint={hint}><input type="number" className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Cài đặt" subtitle="Chế độ AI, quyền tự chủ của Agent, trần an toàn và phân quyền cho TAKIKA." />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Thông tin doanh nghiệp">
          <dl className="space-y-2.5 text-sm">
            {[["Tên doanh nghiệp", data.biz?.name], ["Múi giờ", data.biz?.timezone], ["Tiền tệ", data.biz?.currency], ["Giờ yên lặng", s.quietHours ? `${s.quietHours[0]}h – ${s.quietHours[1]}h (không nhắn khách)` : "—"], ["Ngưỡng tin cậy ghi nhận nguồn", `${Math.round((s.attributionMinConfidence ?? 0) * 100)}%`], ["Khởi tạo", dt(data.biz?.created_at)]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium text-ink">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Chế độ AI" className="xl:col-span-2">
          {!sys ? <Loading /> : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-line p-4">
                <div className="flex items-center justify-between"><p className="font-medium text-ink">Jev · System One</p><JevBadge source={sys.jev.enabled ? "jev" : "heuristic"} /></div>
                <p className="text-sm text-muted">{sys.jev.enabled ? `Đang chạy thật · model ${sys.jev.model}` : "Chế độ heuristic (chưa có khóa)"}</p>
                <p className="text-xs text-muted">Biến môi trường: <code className="rounded bg-soft px-1">TYPESAFE_API_KEY</code> {sys.jev.enabled ? <Badge tone="green">đã đặt</Badge> : <Badge tone="amber">chưa đặt</Badge>}</p>
              </div>
              <div className="space-y-2 rounded-xl border border-line p-4">
                <div className="flex items-center justify-between"><p className="font-medium text-ink">Claude (agent soạn thảo)</p>{sys.llm.enabled ? <Badge tone="green">LIVE</Badge> : <Badge tone="amber">Sandbox</Badge>}</div>
                <p className="text-sm text-muted">{sys.llm.provider === "claude_cli" ? "Qua tài khoản Claude đã đăng nhập (Claude Code CLI)" : "Sandbox — chưa gọi AI"}</p>
                <p className="text-xs text-muted">Chọn nhà cung cấp và model ở thẻ "Model Claude" bên dưới.</p>
              </div>
              <p className="text-xs text-muted md:col-span-2">Đặt khóa trong file <code className="rounded bg-soft px-1">.env</code> ở thư mục dự án rồi khởi động lại API. Giao diện không bao giờ hiển thị giá trị khóa.</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="Model Claude — nhà cung cấp & model theo tầng"><LlmPanel /></Card>

      <div className="grid gap-4 md:grid-cols-3">
        {[["/ads/integrations", Link2, "Trung tâm tích hợp", "Facebook, TikTok, Google Sheets, Telegram, Pancake, Nhanh.vn, whitelist"], ["/ads/ai-gateway", MonitorCog, "Cổng AI (MCP)", "Key phân quyền cho Claude Desktop, Cursor, n8n"], ["/ads/logs", FileClock, "Lịch sử hoạt động", "Mọi thay đổi của Sếp, Agent, rule, MCP"]].map(([to, Icon, t, d]: any) => (
          <Link key={to} to={to} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 transition hover:border-blue-400">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><Icon className="h-5 w-5" /></span>
            <span><span className="block font-semibold text-ink">{t}</span><span className="text-xs text-muted">{d}</span></span>
          </Link>
        ))}
      </div>

      <AgentConfig />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="Trần & chính sách" action={<Button size="sm" variant="primary" icon={Save} loading={saving} onClick={saveCaps}>Lưu</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {num2("maxTotalDailyAdBudget", "Tổng ngân sách quảng cáo tối đa/ngày (VND)", vndFull(Number(f.maxTotalDailyAdBudget)), { step: 1000000 })}
            {num2("maxAdsCreatedPerDay", "Số quảng cáo tạo mới tối đa/ngày")}
            {num2("maxPostsPerDayPerChannel", "Số bài tối đa/ngày/kênh")}
            {num2("postScoreThreshold", "Ngưỡng điểm bài viết (0–100)", "Bài dưới ngưỡng bị chặn hoặc trả về sửa", { min: 0, max: 100 })}
            {num2("explorationPct", "Tỷ lệ thử nghiệm (%)", "Phần ngân sách/nội dung dành cho thử ý tưởng mới", { min: 0, max: 100 })}
            {num2("approvalExpiryHours", "Hạn duyệt (giờ)", "Quá hạn, yêu cầu duyệt tự hết hiệu lực")}
            <div className="sm:col-span-2"><Field label="Người duyệt dự phòng" hint="Nhận yêu cầu duyệt khi Sếp vắng mặt"><input className={inputCls} value={f.backupPerson} onChange={(e) => setF({ ...f, backupPerson: e.target.value })} placeholder="VD: ads@dotaka.vn" /></Field></div>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><OctagonX className="h-4 w-4 text-rose-500" />Dừng khẩn cấp</span>}>
          <div className="space-y-3">
            {KILL.map((k) => (
              <div key={k.area} className={cx("flex items-center justify-between gap-3 rounded-xl border p-3", s.killSwitch[k.area] ? "border-rose-500/40 bg-rose-500/10" : "border-line")}>
                <div><p className="text-sm font-medium text-ink">{k.label}</p><p className="text-xs text-muted">{k.desc}</p></div>
                <Toggle checked={!!s.killSwitch[k.area]} onChange={(v) => kill(k.area, v)} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6">
        <Card title="Tài khoản của tôi"><AccountForm /></Card>
        <UsersCard users={users ?? []} onChange={reloadUsers} />
      </div>

      <Card title="Chi phí AI (7 ngày)">
        {!usage ? <Loading /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[600px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Agent", "Nhà cung cấp · model", "Lượt gọi", "Token vào", "Token ra", "Cache", "Chi phí"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {usage.byAgent.map((u: any) => (
                  <tr key={u.agent_key + u.model}><td className="py-2 pr-3 text-ink">{AGENT_LABEL[u.agent_key] ?? u.agent_key}</td><td className="py-2 pr-3 text-xs text-muted">{u.provider} · {u.model}</td><td className="py-2 pr-3 tabular-nums">{u.calls}</td><td className="py-2 pr-3 tabular-nums">{num(u.tokens_in)}</td><td className="py-2 pr-3 tabular-nums">{num(u.tokens_out)}</td><td className="py-2 pr-3 tabular-nums">{num(u.cached)}</td><td className="py-2 tabular-nums">{usd(u.cost_micros)}</td></tr>
                ))}
                {usage.jev && <tr className="bg-soft/50"><td className="py-2 pr-3 font-medium text-ink">Jev (phán đoán)</td><td className="py-2 pr-3 text-xs text-muted">typesafe · {Math.round(usage.jev.latency ?? 0)} ms TB</td><td className="py-2 pr-3 tabular-nums">{usage.jev.calls}</td><td className="py-2 pr-3 tabular-nums">{num(usage.jev.tokens_in)}</td><td className="py-2 pr-3">—</td><td className="py-2 pr-3">—</td><td className="py-2 tabular-nums">{usd(usage.jev.cost_micros)}</td></tr>}
              </tbody>
            </table>
            {usage.byAgent.length === 0 && <Empty>Chưa có lượt gọi model nào trong 7 ngày.</Empty>}
          </div>
        )}
      </Card>

    </div>
  );
}

type UserRow = { id: string; name: string; email: string; role: string; status: string; last_active_at: string | null };

/** Người dùng & phân quyền của doanh nghiệp đang xem: thêm / sửa / tạm khoá / xoá. */
function UsersCard({ users, onChange }: { users: UserRow[]; onChange: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<null | { id?: string; name: string; email: string; role: string; status: string }>(null);
  const [del, setDel] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = { name: edit.name, email: edit.email, role: edit.role, status: edit.status };
      if (edit.id) await api.put(`users/${edit.id}`, body); else await api.post("users", body);
      toast(edit.id ? "Đã cập nhật người dùng" : "Đã thêm người dùng");
      setEdit(null); onChange();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try { await api.del(`users/${del.id}`); toast(`Đã xoá ${del.name}`); setDel(null); onChange(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Card title="Người dùng & phân quyền" action={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: "", email: "", role: "sales", status: "active" })}>Thêm người</Button>}>
      <p className="mb-3 text-xs text-muted">Vai trò dùng để ghi nhận ai làm gì. Hệ thống chạy trên máy Sếp và chưa có đăng nhập theo từng người, nên chưa giới hạn quyền theo vai trò.</p>
      {users.length === 0 ? <Empty>Chưa có người dùng — thêm người cùng vận hành để ghi nhận ai làm gì.</Empty> : (
        <div className="divide-y divide-line">
          {users.map((u) => (
            <div key={u.id} className={cx("flex items-center gap-3 py-2.5", u.status !== "active" && "opacity-60")}>
              <Avatar name={u.name} size={34} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{u.name}{u.status !== "active" && <span className="ml-2 text-xs text-muted">(đã khoá)</span>}</p><p className="truncate text-xs text-muted">{u.email}{u.last_active_at ? ` · hoạt động ${timeAgo(u.last_active_at)}` : ""}</p></div>
              <Badge tone={ROLE[u.role]?.tone ?? "gray"}>{ROLE[u.role]?.label ?? u.role}</Badge>
              <button onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status })} className="rounded-md p-1.5 text-muted hover:bg-soft hover:text-ink" aria-label={`Sửa ${u.name}`} title="Sửa"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => setDel(u)} className="rounded-md p-1.5 text-muted hover:bg-soft hover:text-rose-600" aria-label={`Xoá ${u.name}`} title="Xoá"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? "Sửa người dùng" : "Thêm người dùng"}
        footer={<><Button onClick={() => setEdit(null)}>Huỷ</Button><Button variant="primary" loading={busy} onClick={save}>{edit?.id ? "Lưu" : "Thêm"}</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Họ tên"><input autoFocus className={inputCls} value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputCls} value={edit.email} maxLength={120} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Vai trò">
              <select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            {edit.id && <label className="flex items-center justify-between text-sm"><span>Đang hoạt động</span><Toggle checked={edit.status === "active"} onChange={(v) => setEdit({ ...edit, status: v ? "active" : "disabled" })} /></label>}
          </div>
        )}
      </Modal>
      <Modal open={del !== null} onClose={() => setDel(null)} title="Xoá người dùng?"
        footer={<><Button onClick={() => setDel(null)}>Huỷ</Button><Button variant="danger" loading={busy} onClick={remove}>Xoá</Button></>}>
        <p className="text-sm text-muted">Xoá <b className="text-ink">{del?.name}</b> khỏi danh sách người dùng của doanh nghiệp này. Nhật ký cũ vẫn giữ nguyên.</p>
      </Modal>
    </Card>
  );
}
