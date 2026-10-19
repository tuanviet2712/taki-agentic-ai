import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, LogIn, LogOut, PlugZap, Sparkles, Terminal } from "lucide-react";
import { api, useApi } from "../lib/api";
import { Badge, Button, Loading, cx, inputCls, useToast } from "./ui";
import { AiAccounts } from "./AiAccounts";

const PROVIDERS = [
  { id: "claude_cli", label: "Tài khoản Claude (Claude Code CLI)", short: "Claude Code CLI", hint: "Dùng gói Claude Sếp đang đăng nhập trên máy — không cần API key. Chạy lệnh `claude` ở chế độ nền." },
  { id: "grok_cli", label: "Tài khoản Grok Bot (Grok CLI)", short: "Grok Bot CLI", hint: "Dùng tài khoản Grok / xAI (OAuth hoặc XAI_API_KEY). Tự động kích hoạt lệnh `grok` khi chọn model Grok." },
  { id: "codex_cli", label: "Tài khoản ChatGPT (Codex CLI)", short: "ChatGPT (Codex CLI)", hint: "Đăng nhập ChatGPT theo từng hồ sơ, linh hoạt chọn tài khoản dùng cho các agent." },
  { id: "gemini_cli", label: "Tài khoản Gemini (Gemini CLI)", short: "Gemini CLI", hint: "Dùng tài khoản Google Gemini đã đăng nhập trên máy hoặc GEMINI_API_KEY." },
  { id: "sandbox", label: "Sandbox (không gọi AI)", short: "Sandbox", hint: "Bản nháp mẫu theo DNA — dùng để thử quy trình." },
] as const;

const PROVIDER_GROUP_LABEL: Record<string, string> = {
  grok_cli: "Grok Bot (Grok CLI)",
  claude_cli: "Claude (Claude Code CLI)",
  codex_cli: "ChatGPT (Codex CLI)",
  gemini_cli: "Google Gemini (Gemini CLI)",
};

const TIERS = [
  { key: "small", label: "Tầng nhỏ", use: "Chat khách, tóm tắt chuyển người" },
  { key: "medium", label: "Tầng vừa", use: "Brief, bài viết, kịch bản video, SEO, Ngân Nguyệt" },
  { key: "large", label: "Tầng lớn", use: "Nghiên cứu thị trường, chiến lược" },
] as const;

/** Provider + model-per-tier selection, used on the Settings page. */
export function LlmPanel() {
  const { data, reload, setData } = useApi<any>("llm", ["llm."]);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [grokBusy, setGrokBusy] = useState(false);
  const [grokKey, setGrokKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const toast = useToast();
  useEffect(() => { setResults({}); }, [data?.settings?.provider, data?.settings?.codexAccountId]);
  if (!data) return <Loading />;
  const s = data.settings;
  const grok = data.grok ?? {};
  const gemini = data.gemini ?? {};
  const allCatalogs: Record<string, any[]> = data.allCatalogs ?? {};

  const save = async (patch: any, msg: string) => {
    try {
      const r = await api.put("llm", patch);
      setData({ ...data, settings: r.settings, effective: r.effective, catalog: r.catalog, allCatalogs: r.allCatalogs ?? data.allCatalogs, selectedAccount: r.selectedAccount, grok: r.grok ?? data.grok, gemini: r.gemini ?? data.gemini });
      toast(msg);
      return true;
    } catch (e: any) { toast(e.message, "err"); reload(); return false; }
  };
  const test = async (model: string) => {
    const key = `${s.provider}:${s.codexAccountId ?? ""}:${model}`;
    setTesting(key);
    try {
      const r = await api.post("llm/test", { model });
      setResults((x) => ({ ...x, [key]: r }));
      toast(r.ok ? `${model} trả lời sau ${(r.latencyMs / 1000).toFixed(1)}s` : `Lỗi: ${r.reason}`, r.ok ? "ok" : "err");
    } catch (e: any) { toast(e.message, "err"); } finally { setTesting(null); }
  };

  const loginGrok = async (method: "browser" | "device") => {
    setGrokBusy(true);
    try {
      const st = await api.post("llm/grok/login", { method });
      if (st?.loginUrl && method === "browser") window.open(st.loginUrl, "_blank", "noopener,noreferrer");
      toast(method === "device" ? "Đã tạo mã đăng nhập Grok — mở link và nhập mã" : "Đang mở trang đăng nhập Grok xAI trên trình duyệt…");
      reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setGrokBusy(false); }
  };

  const saveGrokApiKey = async () => {
    setGrokBusy(true);
    try {
      await api.post("llm/grok/apikey", { apiKey: grokKey.trim() });
      await save({ provider: "grok_cli" }, grokKey.trim() ? "Đã lưu XAI_API_KEY và kích hoạt Grok CLI" : "Đã xóa XAI_API_KEY");
      setGrokKey("");
      reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setGrokBusy(false); }
  };

  const saveGeminiApiKey = async () => {
    try {
      await api.post("llm/gemini/apikey", { apiKey: geminiKey.trim() });
      await save({ provider: "gemini_cli" }, geminiKey.trim() ? "Đã lưu GEMINI_API_KEY và kích hoạt Gemini CLI" : "Đã xóa GEMINI_API_KEY");
      setGeminiKey("");
      reload();
    } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {PROVIDERS.map((p) => {
          const active = s.provider === p.id;
          return (
            <button key={p.id} onClick={() => !active && save({ provider: p.id }, `Đã kích hoạt CLI: ${p.label}`)} className={cx("rounded-xl border p-3 text-left transition", active ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:bg-soft")}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">{active && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />}<span>{p.label}</span></p>
              <p className="mt-1 text-xs text-muted">{p.hint}</p>
            </button>
          );
        })}
      </div>

      {/* Grok Bot CLI connection box */}
      <div className={cx("rounded-xl border p-4 space-y-3", s.provider === "grok_cli" ? "border-blue-500/50 bg-blue-500/5" : "border-line bg-card")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-ink">Kết nối Grok Bot CLI (@xai-official/grok)</span>
            <Badge tone={grok.available ? "green" : "red"}>{grok.available ? `v${grok.version}` : "chưa cài"}</Badge>
            <Badge tone={grok.loggedIn ? "green" : "amber"}>{grok.loggedIn ? `Đã kết nối (${grok.authMethod === "api_key" ? "XAI_API_KEY" : "OAuth xAI"})` : "Chưa đăng nhập"}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={LogIn} loading={grokBusy || grok.loginState?.status === "starting"} onClick={() => loginGrok("browser")}>Đăng nhập Grok (Trình duyệt)</Button>
            <Button size="sm" icon={KeyRound} loading={grokBusy} onClick={() => loginGrok("device")}>Đăng nhập bằng mã</Button>
            {grok.loggedIn && grok.authMethod === "oauth" && (
              <Button size="sm" variant="danger" icon={LogOut} onClick={async () => { await api.post("llm/grok/disconnect"); toast("Đã ngắt kết nối Grok OAuth"); reload(); }}>Ngắt kết nối</Button>
            )}
          </div>
        </div>

        {grok.loginState && ["starting", "waiting"].includes(grok.loginState.status) && (
          <div className="rounded-xl border border-blue-400/50 bg-card p-3 text-xs space-y-1.5">
            <p className="font-semibold text-ink">{grok.loginState.message}</p>
            {grok.loginState.userCode && (
              <p className="text-ink">Mã xác thực của Sếp: <code className="rounded bg-blue-500/15 px-2 py-0.5 text-sm font-bold text-blue-700 dark:text-blue-300">{grok.loginState.userCode}</code></p>
            )}
            {grok.loginState.loginUrl && (
              <p><a href={grok.loginState.loginUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">Mở trang xác thực xAI Grok <ExternalLink className="h-3.5 w-3.5" /></a></p>
            )}
            <Button size="sm" onClick={async () => { await api.post("llm/grok/cancel"); reload(); }}>Hủy phiên đăng nhập</Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Hoặc nhập trực tiếp <code className="rounded bg-soft px-1">XAI_API_KEY</code>:</span>
          <input type="password" className={cx(inputCls, "max-w-xs py-1 text-xs")} placeholder="xai-..." value={grokKey} onChange={(e) => setGrokKey(e.target.value)} />
          <Button size="sm" onClick={saveGrokApiKey}>{grokKey.trim() ? "Lưu khóa & Kích hoạt Grok" : "Xóa khóa"}</Button>
          <span className="text-muted">· Hoặc gõ <code className="rounded bg-soft px-1">grok login</code> trong Terminal.</span>
        </div>
      </div>

      {/* Gemini CLI connection box (shown when gemini_cli is selected) */}
      {s.provider === "gemini_cli" && (
        <div className="rounded-xl border border-blue-500/50 bg-blue-500/5 p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">Kết nối Google Gemini CLI</span>
            <Badge tone={gemini.available ? "green" : "red"}>{gemini.available ? `v${gemini.version}` : "chưa cài"}</Badge>
            <Badge tone={gemini.loggedIn ? "green" : "amber"}>{gemini.loggedIn ? `Đã kết nối (${gemini.authMethod})` : "Chưa đăng nhập"}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Nhập <code className="rounded bg-soft px-1">GEMINI_API_KEY</code> (hoặc đăng nhập bằng lệnh <code className="rounded bg-soft px-1">gemini</code> trong Terminal):</span>
            <input type="password" className={cx(inputCls, "max-w-xs py-1 text-xs")} placeholder="AIza..." value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
            <Button size="sm" onClick={saveGeminiApiKey}>{geminiKey.trim() ? "Lưu khóa & Kích hoạt Gemini" : "Xóa khóa"}</Button>
          </div>
        </div>
      )}

      <AiAccounts selectedId={s.codexAccountId} available={!!data.codex?.available} onChange={reload} onSelect={async (id) => { await api.put("llm", { provider: "codex_cli", codexAccountId: id }); toast("Đã chọn tài khoản ChatGPT cho đội AI"); }} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-soft p-3 text-xs">
        <Terminal className="h-4 w-4 text-muted" />
        <span>
          {s.provider === "codex_cli" ? (
            <>Codex CLI: <Badge tone={data.codex?.available ? "green" : "red"}>{data.codex?.version ?? "chưa cài"}</Badge> · Hồ sơ: {data.selectedAccount?.name ?? "chưa chọn"}</>
          ) : s.provider === "grok_cli" ? (
            <>Grok CLI: <Badge tone={grok.available ? (grok.loggedIn ? "green" : "amber") : "red"}>{grok.available ? `grok ${grok.version}` : "chưa cài"}</Badge></>
          ) : s.provider === "gemini_cli" ? (
            <>Gemini CLI: <Badge tone={gemini.available ? (gemini.loggedIn ? "green" : "amber") : "red"}>{gemini.available ? `gemini ${gemini.version}` : "chưa cài"}</Badge></>
          ) : (
            <>Claude CLI: {data.cli.available ? <Badge tone={data.cli.loggedIn === false ? "red" : data.cli.loggedIn === null ? "amber" : "green"}>{data.cli.version}</Badge> : <Badge tone="red">không tìm thấy lệnh `claude`</Badge>}</>
          )}
        </span>
        <span>· Trạng thái AI đang chạy: <Badge tone={data.effective.provider === "sandbox" || data.effective.ready === false ? "amber" : "green"}>{data.effective.ready === false ? `${PROVIDERS.find((p) => p.id === s.provider)?.short ?? s.provider} — chưa sẵn sàng` : PROVIDERS.find((p) => p.id === data.effective.provider)?.label}</Badge></span>
        {data.effective.reason && <span className="text-amber-600">({data.effective.reason})</span>}
        <span className="ml-auto text-[11px] text-blue-600 dark:text-blue-400">⚡ Đổi model bất kỳ sẽ tự động kích hoạt CLI tương ứng</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-2">Tầng</th><th>Dùng cho</th><th>Model (chọn model từ bất kỳ CLI nào để tự động chuyển & kích hoạt)</th><th className="text-right">Kiểm tra</th></tr></thead>
          <tbody className="divide-y divide-line">
            {TIERS.map((t) => {
              const model = s.models[t.key];
              const resultKey = `${s.provider}:${s.codexAccountId ?? ""}:${model}`;
              const r = results[resultKey];
              return (
                <tr key={t.key}>
                  <td className="py-2.5 font-medium">{t.label}</td>
                  <td className="text-xs text-muted">{t.use}</td>
                  <td className="py-2">
                    <div className="flex gap-1.5">
                      <select
                        className={cx(inputCls, "py-1.5 text-sm flex-1")}
                        value={model}
                        onChange={(e) => save({ models: { [t.key]: e.target.value }, autoSwitch: true }, `${t.label} → ${e.target.value} (tự động kích hoạt CLI)`)}
                      >
                        {Object.entries(allCatalogs).length > 0 ? (
                          Object.entries(allCatalogs).map(([prov, items]) => (
                            <optgroup key={prov} label={PROVIDER_GROUP_LABEL[prov] ?? prov}>
                              {(items as any[]).map((m: any) => (
                                <option key={`${prov}-${m.id}`} value={m.id}>{m.label} ({m.id}) — {m.note}</option>
                              ))}
                            </optgroup>
                          ))
                        ) : (
                          data.catalog.map((m: any) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)
                        )}
                      </select>
                      {(s.provider === "codex_cli" || s.provider === "grok_cli") && (
                        <input
                          key={`${t.key}-${model}`}
                          className={cx(inputCls, "w-44 py-1.5 text-xs font-mono")}
                          aria-label={`Model ${t.label}`}
                          list="all-cli-models"
                          defaultValue={model}
                          placeholder="Nhập ID model…"
                          onBlur={async (e) => {
                            const field = e.currentTarget;
                            const v = field.value.trim();
                            if (!v) field.value = model;
                            else if (v !== model && !await save({ models: { [t.key]: v }, autoSwitch: true }, `${t.label} → ${v}`)) field.value = model;
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    <Button size="sm" icon={PlugZap} loading={testing === resultKey} disabled={!!testing || data.effective.provider === "sandbox" || data.effective.ready === false} onClick={() => test(model)}>Thử</Button>
                    {r && <p className={cx("mt-1 text-[11px]", r.ok ? "text-emerald-600" : "text-rose-600")}>{r.ok ? `OK · ${(r.latencyMs / 1000).toFixed(1)}s` : "Lỗi"}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <datalist id="all-cli-models">{data.catalog.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">Mức suy nghĩ (effort):</span>
        {(["low", "medium", "high"] as const).map((e) => (
          <button key={e} onClick={() => save({ effort: e }, `Effort: ${e}`)} className={cx("rounded-full px-3 py-1 text-xs", s.effort === e ? "bg-blue-600 text-white" : "bg-soft text-ink hover:bg-line")}>{e === "low" ? "Thấp (nhanh)" : e === "medium" ? "Vừa" : "Cao (kỹ hơn)"}</button>
        ))}
      </div>
      <p className="text-xs text-muted">Sếp có thể đổi linh hoạt giữa <b>Claude Code CLI</b>, <b>Grok Bot CLI</b>, <b>ChatGPT (Codex CLI)</b> và <b>Gemini CLI</b>. Khi chọn bất kỳ model nào (ở đây hoặc trong khung chat Trợ lý Ngân Nguyệt), hệ thống sẽ tự động kích hoạt đúng bộ CLI của model đó.</p>
    </div>
  );
}
