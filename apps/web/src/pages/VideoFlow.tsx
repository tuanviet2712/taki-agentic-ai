import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clapperboard, CookingPot, Newspaper, UserRound, Wand2, ExternalLink, Film, Globe, ImagePlus, Loader2, Mic, PersonStanding, Play, Shirt, Sparkles, Square, Store, Trash2, UtensilsCrossed } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, cx, inputCls, useToast } from "../components/ui";

const TOOL_ICON: Record<string, any> = { "review-do-an-vat": UtensilsCrossed, "review-thoi-trang": Shirt, "nguoi-que-so-sanh": PersonStanding, "nhan-hieu": Mic, "koc-thoi-trang-nu": Sparkles, "review-gia-dung": CookingPot, "review-nha-hang": Store, "cooking-director": Clapperboard, cinematic: Film, "auto-video": Wand2, "news-video": Newspaper, portrait: UserRound };
const STATUS: Record<string, [string, any]> = {
  queued: ["Chờ trình duyệt", "gray"], running: ["Đang sản xuất", "blue"], done: ["Xong, chờ duyệt", "green"],
  approved: ["Đã duyệt", "blue"], drafted: ["Đã lên nháp kênh", "green"],
  failed: ["Lỗi", "red"], blocked: ["Bị chặn", "amber"], cancelled: ["Đã hủy", "gray"],
};
// Order = default role for the 1st, 2nd… uploaded image. Names map onto the Tool's slots (A nhân vật, B bao bì, I bên trong, E bối cảnh).
const ROLES = ["Bao bì / sản phẩm", "Nhân vật / người review", "Bên trong sản phẩm", "Bối cảnh / góc bếp", "Nhân vật 2", "Phong cách"];
const CHANNELS = ["tiktok", "facebook", "instagram"];

export function VideoFlow() {
  const [params] = useSearchParams();
  const tools = useApi<any[]>("creative/tools");
  const settings = useApi<any>("creative/settings");
  const { data: sys } = useApi<any>("system");
  const jobs = useApi<any[]>("creative/jobs", ["creative.", "approval."]);
  const fb = useApi<any>("creative/flow-browser", ["creative."]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickBrowser, setPickBrowser] = useState(false);
  const toast = useToast();

  const [form, setForm] = useState<any>({
    tool: "review-do-an-vat", title: "", brand: "other", product: "", brief: "", durationSec: 48, veoModel: "Veo 3.1 - Fast", voice: "", hookTitle: "", cta: "", channels: ["tiktok"], images: [] as { path: string; role: string; name: string }[],
    // ảnh theo ô (vai trò) + ảnh tham khảo khác; local engines (Video tự động / Ảnh cử động)
    video: { source: "flow", flowJobId: "", scriptReady: false, terms: "", voiceName: "vi-VN-HoaiMyNeural-Female", voiceRate: 1, bgm: "random", aspect: "9:16", clipDuration: 4, driving: "d12.mp4", drivingPath: "", drivingName: "", voiceText: "", seconds: 6, materials: [] as { path: string; name: string }[] },
  });
  const vai = useApi<any>("video-ai/status");
  const setV = (p: any) => setForm((f: any) => ({ ...f, video: { ...f.video, ...p } }));
  const [confirm, setConfirm] = useState(false);
  const [allJobs, setAllJobs] = useState(false); // list shows the 3 latest runs unless expanded
  const [busy, setBusy] = useState(false);
  const set = (p: any) => setForm((f: any) => ({ ...f, ...p }));

  // Prefill from an approved video script (Nội dung → "Sản xuất trên Flow")
  useEffect(() => {
    const from = params.get("from");
    if (!from) return;
    // Kịch bản → đúng skill + lời đọc đã làm sạch (script-video.ts), không dán nguyên kịch bản sản xuất.
    api.get(`content/${from}/video-plan`).then((p) => {
      const i = p.input;
      setForm((f: any) => ({
        ...f, tool: i.tool, title: i.title, brief: i.brief, brand: "taki", sourceContentId: i.sourceContentId, product: i.product ?? "", voice: i.voice ?? "",
        hookTitle: i.hookTitle ?? "", cta: i.cta ?? "", durationSec: i.durationSec ?? f.durationSec, channels: (i.channels ?? []).filter((x: string) => CHANNELS.includes(x)),
        images: (i.images ?? []).map((m: any) => ({ ...m, name: m.path.split("/").pop() })), video: { ...f.video, ...(i.video ?? {}) },
      }));
      setSelected(i.tool);
      if (p.missing?.length) toast(`Kịch bản "${p.title}": ${p.missing.join("; ")}`, "info");
    }).catch((e) => toast(e.message, "err"));
  }, [params]);

  /** Upload images; with `role` the image fills that slot (replacing what was there), else it is an extra reference. */
  const upload = async (files: FileList | File[] | null, role?: string) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name));
    if (!list.length) { toast("Chỉ nhận ảnh png/jpg/webp/heic", "err"); return; }
    for (const f of role ? list.slice(0, 1) : list.slice(0, Math.max(0, 8 - form.images.length))) {
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
      try {
        const r = await api.post("/v1/uploads", { name: f.name, data });
        const img = { path: r.path, role: role ?? "Ảnh tham khảo khác", name: f.name, preview: URL.createObjectURL(f) };
        setForm((x: any) => ({ ...x, images: role ? [...x.images.filter((i: any) => i.role !== role), img] : [...x.images, img] }));
      } catch (e: any) { toast(`${f.name}: ${e.message}`, "err"); }
    }
  };

  const uploadFiles = async (files: FileList | null, accept: RegExp) => {
    const out: { path: string; name: string }[] = [];
    for (const f of Array.from(files ?? [])) {
      if (!accept.test(f.name)) { toast(`${f.name}: định dạng không hỗ trợ`, "err"); continue; }
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
      try { const r = await api.post("/v1/uploads", { name: f.name, data }); out.push({ path: r.path, name: f.name }); } catch (e: any) { toast(`${f.name}: ${e.message}`, "err"); }
    }
    return out;
  };

  const start = async () => {
    setBusy(true);
    try {
      const { images, video, ...rest } = form;
      const v = engine === "moneyprinter"
        ? { source: video.source, flowJobId: video.source === "flow" ? video.flowJobId || undefined : undefined, materials: video.source === "local" ? video.materials.map((m: any) => m.path) : undefined, scriptReady: video.scriptReady || undefined, terms: video.terms || undefined, voiceName: video.voiceName, voiceRate: Number(video.voiceRate), bgm: video.bgm, aspect: video.aspect, clipDuration: Number(video.clipDuration) }
        : engine === "liveportrait" ? { driving: video.drivingPath ? undefined : video.driving, drivingPath: video.drivingPath || undefined, voiceText: video.voiceText || undefined, voiceName: video.voiceName, seconds: Number(video.seconds) } : undefined;
      const brief = form.brief.trim().length >= 5 ? form.brief : `${form.title} — ${tool?.label ?? ""}`;
      const slotRoles = new Set((tool?.slots ?? []).map((x: any) => x.role));
      const used = engine === "flow" ? images : images.filter((i: any) => slotRoles.has(i.role)); // local engines use their own slots only
      const j = await api.post("creative/jobs", { ...rest, brief, video: v, durationSec: Number(form.durationSec) || undefined, images: used.map((i: any) => ({ path: i.path, role: i.role })), product: form.product || undefined, voice: form.voice || undefined, hookTitle: form.hookTitle || undefined, cta: form.cta || undefined });
      toast(engine === "flow" ? "Đã đưa vào hàng đợi. Agent chạy ngầm trong Chrome Flow — Sếp sẽ nhận thông báo khi video xong." : "Đã đưa vào hàng đợi — chạy trên máy Sếp, có thông báo khi xong.", "info");
      setConfirm(false);
      setSelected(j.id);
      jobs.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  const tool = tools.data?.find((t) => t.key === form.tool);
  const engine: "flow" | "moneyprinter" | "liveportrait" | "news" = tool?.engine ?? "flow";
  const flowDone = (jobs.data ?? []).filter((j: any) => !["auto-video", "portrait", "news-video"].includes(j.tool) && ["done", "approved", "drafted"].includes(j.status));
  const hasBrowser = !!settings.data?.chromeProfileDir;
  const fbAccount = fb.data?.accounts?.includes(settings.data?.chromeProfileEmail) ? settings.data.chromeProfileEmail : fb.data?.accounts?.[0];
  const showFlow = async (state: "normal" | "parked") => { try { await api.post("creative/flow-browser/window", { state }); } catch (e: any) { toast(e.message, "err"); } };
  const login = async () => { try { await api.post("creative/flow-browser/login"); toast("Đã mở Chrome Flow ở trang đăng nhập Google — Sếp đăng nhập 1 lần", "info"); fb.reload(); } catch (e: any) { toast(e.message, "err"); } };
  const cliOk = sys?.llm?.provider === "claude_cli";
  const ready = engine === "flow" ? hasBrowser && cliOk : engine === "moneyprinter" ? cliOk && !!vai.data?.moneyprinter?.installed : engine === "news" ? cliOk && !!vai.data?.remotion?.installed : !!vai.data?.liveportrait?.installed;
  const current = selected ?? jobs.data?.[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Sản xuất video" subtitle="Google Flow (AI tạo cảnh, chạy trong Tool của skill) · Video tự động từ cảnh có sẵn + giọng đọc Việt · Ảnh chân dung cử động — xong thì Review, gửi duyệt và đăng nháp lên kênh." />

      <div className={cx("flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm", ready ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/10")}>
        <Globe className="h-5 w-5" />
        <span>Tài khoản Flow: {settings.data?.chromeProfileDir ? <b>{settings.data.chromeProfileName}{settings.data.chromeProfileEmail ? ` · ${settings.data.chromeProfileEmail}` : ""}</b> : <b className="text-amber-700 dark:text-amber-300">chưa chọn profile</b>}</span>
        <span>· Chrome Flow: {!fb.data ? "…" : fbAccount ? <Badge tone="green">đã đăng nhập {fbAccount}</Badge> : fb.data.running ? <Badge tone="amber">chưa đăng nhập</Badge> : <Badge>tự mở khi chạy</Badge>}</span>
        <span>· Claude: {sys?.llm?.provider === "claude_cli" ? <Badge tone="green">tài khoản CLI</Badge> : <Badge tone="amber">cần chế độ tài khoản Claude</Badge>}</span>
        <Button size="sm" onClick={() => setPickBrowser(true)}>{hasBrowser ? "Đổi profile Chrome" : "Chọn profile Chrome"}</Button>
        {fb.data?.running && (fbAccount ? <><Button size="sm" variant="ghost" onClick={() => showFlow("normal")}>Xem Chrome Flow</Button><Button size="sm" variant="ghost" onClick={() => showFlow("parked")}>Cất Chrome Flow</Button></> : <Button size="sm" variant="soft" onClick={login}>Đăng nhập Chrome Flow</Button>)}
        <span className="w-full text-xs text-muted">Chrome Flow là cửa sổ Chrome riêng (cất ở mép phải màn hình) mang sẵn đăng nhập của profile đã chọn — AI tự bấm bên trong Tool Flow, không đụng tới Chrome Sếp đang dùng. Không cần bấm gì, chỉ có thông báo khi video xong.</span>
      </div>

      <ScriptsToVideo />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card title="Tạo video mới">
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {(tools.data ?? []).map((t) => {
                const Icon = TOOL_ICON[t.key] ?? Film;
                return (
                  <button key={t.key} onClick={() => set({ tool: t.key, durationSec: t.key === "cinematic" ? 60 : t.key === "cooking-director" ? 80 : t.key === "auto-video" ? 30 : t.key === "review-thoi-trang" ? 40 : t.key === "nhan-hieu" ? 50 : t.key === "review-gia-dung" ? 40 : t.key === "review-nha-hang" ? 32 : t.key === "news-video" ? 60 : 48 })} className={cx("rounded-xl border p-3 text-left transition", form.tool === t.key ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:bg-soft")}>
                    <Icon className="h-5 w-5 text-blue-600" />
                    <p className="mt-2 text-sm font-semibold">{t.label}</p>
                    <p className="text-[11px] text-muted">~{t.minutes} phút · {t.engine && t.engine !== "flow" ? "chạy trên máy, không tốn credit" : `Google Flow · skill v${t.skillVersion ?? "?"}`}</p>
                  </button>
                );
              })}
            </div>
            {tool && (
              <div className="space-y-1 rounded-xl bg-soft p-3 text-xs text-muted">
                <p>Cần: {tool.hint}</p>
                {engine === "flow"
                  ? <p>Tool Flow: {tool.toolUrl ? <a href={tool.toolUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600">{tool.label}<ExternalLink className="h-3 w-3" /></a> : <span>agent tự tìm "{tool.label}" trong mục Tools của Flow</span>}</p>
                  : <p>{engine === "moneyprinter" ? "MoneyPrinterTurbo (MIT) + Claude CLI viết lời + Edge TTS giọng Việt" : engine === "news" ? "Skill news-to-video: Claude CLI + Edge TTS + whisper + Remotion (phụ đề karaoke, đồ hoạ động)" : "LivePortrait (MIT, dò mặt MediaPipe — dùng thương mại được)"} · chạy trên máy Sếp{vai.data && !(engine === "moneyprinter" ? vai.data.moneyprinter.installed : engine === "news" ? vai.data.remotion?.installed : vai.data.liveportrait.installed) ? " · CHƯA CÀI — chạy pnpm video-ai:install" : ""}</p>}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tên video"><input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Review bánh tráng trộn Tây Ninh" /></Field>
              <Field label="Thương hiệu / kênh" hint={form.brand === "taki" ? "Áp DNA TAKI (giọng, claim cấm)" : "Kênh affiliate/khách: không dùng giọng TAKI"}>
                <select className={inputCls} value={form.brand} onChange={(e) => set({ brand: e.target.value })}><option value="other">Kênh khác / khách hàng</option><option value="taki">TAKI Academy (áp DNA)</option></select>
              </Field>
              <Field label="Sản phẩm"><input className={inputCls} value={form.product} onChange={(e) => set({ product: e.target.value })} /></Field>
              {engine !== "liveportrait" && <Field label="Thời lượng (giây)" hint={engine === "flow" ? `${Math.max(1, Math.ceil((Number(form.durationSec) || 8) / 8))} cảnh × 8 giây` : `~${Math.round((Number(form.durationSec) || 30) * 3)} từ lời đọc`}><input type="number" className={inputCls} value={form.durationSec} onChange={(e) => set({ durationSec: e.target.value })} /></Field>}
              {engine === "flow" && <Field label="Model Veo (nếu Tool cho chọn)" hint="Lite rẻ nhất · Quality đẹp nhất, tốn credit hơn">
                <select className={inputCls} value={form.veoModel} onChange={(e) => set({ veoModel: e.target.value })}>{["Veo 3.1 - Lite", "Veo 3.1 - Fast", "Veo 3.1 - Quality"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </Field>}
            </div>
            {engine === "moneyprinter" && (
              <div className="space-y-3 rounded-xl border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nguồn cảnh quay">
                    <select className={inputCls} value={form.video.source} onChange={(e) => setV({ source: e.target.value })}>
                      <option value="flow">Clip từ video Flow đã làm</option>
                      <option value="local">Clip / ảnh của Sếp (tải lên)</option>
                      <option value="pexels" disabled={!vai.data?.moneyprinter?.pexels?.length}>Kho Pexels (miễn phí){vai.data?.moneyprinter?.pexels?.length ? "" : " — cần nhập khóa"}</option>
                      <option value="pixabay" disabled={!vai.data?.moneyprinter?.pixabay?.length}>Kho Pixabay (miễn phí){vai.data?.moneyprinter?.pixabay?.length ? "" : " — cần nhập khóa"}</option>
                    </select>
                  </Field>
                  {form.video.source === "flow" && (
                    <Field label="Video Flow lấy clip">
                      <select className={inputCls} value={form.video.flowJobId} onChange={(e) => setV({ flowJobId: e.target.value })}>
                        <option value="">— chọn —</option>
                        {flowDone.map((j: any) => <option key={j.id} value={j.id}>{j.title} · {timeAgo(j.created_at)}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Giọng đọc">
                    <select className={inputCls} value={form.video.voiceName} onChange={(e) => setV({ voiceName: e.target.value })}>{(vai.data?.tts?.voices ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                  </Field>
                  <Field label={`Tốc độ đọc ×${form.video.voiceRate}`}><input type="range" min={0.8} max={1.3} step={0.05} value={form.video.voiceRate} onChange={(e) => setV({ voiceRate: e.target.value })} className="w-full" /></Field>
                  <Field label="Khung hình"><select className={inputCls} value={form.video.aspect} onChange={(e) => setV({ aspect: e.target.value })}><option value="9:16">Dọc 9:16 (TikTok/Reels)</option><option value="16:9">Ngang 16:9 (YouTube)</option><option value="1:1">Vuông 1:1</option></select></Field>
                  <Field label="Nhạc nền"><select className={inputCls} value={form.video.bgm} onChange={(e) => setV({ bgm: e.target.value })}><option value="random">Nhạc nền ngẫu nhiên</option><option value="none">Không nhạc</option></select></Field>
                </div>
                {form.video.source === "local" && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {form.video.materials.map((m: any, i: number) => <span key={m.path} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1">{m.name}<button onClick={() => setV({ materials: form.video.materials.filter((_: any, j: number) => j !== i) })}><Trash2 className="h-3 w-3 text-muted" /></button></span>)}
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1 text-muted hover:bg-soft"><Film className="h-3.5 w-3.5" />Thêm clip/ảnh<input type="file" accept="video/*,image/*" multiple className="hidden" onChange={async (e) => { const up = await uploadFiles(e.target.files, /\.(mp4|mov|m4v|webm|png|jpe?g|webp)$/i); setV({ materials: [...form.video.materials, ...up] }); }} /></label>
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.video.scriptReady} onChange={(e) => setV({ scriptReady: e.target.checked })} />Ô nội dung bên dưới là <b>lời đọc có sẵn</b> (không để AI viết lại)</label>
                {form.video.scriptReady && <input className={inputCls} placeholder="Từ khóa cảnh quay tiếng Anh, cách nhau dấu phẩy (để trống = AI tự đề xuất)" value={form.video.terms} onChange={(e) => setV({ terms: e.target.value })} />}
              </div>
            )}
            {engine === "liveportrait" && (
              <div className="space-y-3 rounded-xl border border-line p-3">
                <p className="text-xs text-muted">Thêm <b>1 ảnh chân dung rõ mặt</b> ở mục ảnh bên dưới. Ảnh sẽ cử động theo biểu cảm của video mẫu.</p>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <div className="space-y-2">
                    <Field label="Video biểu cảm mẫu">
                      <select className={inputCls} value={form.video.drivingPath ? "__own" : form.video.driving} onChange={(e) => e.target.value !== "__own" && setV({ driving: e.target.value, drivingPath: "", drivingName: "" })}>
                        {(vai.data?.liveportrait?.presets ?? []).map((d: string) => <option key={d} value={d}>Mẫu {d.replace(".mp4", "")}</option>)}
                        {form.video.drivingPath && <option value="__own">Video của Sếp: {form.video.drivingName}</option>}
                      </select>
                    </Field>
                    <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1 text-xs text-muted hover:bg-soft"><Film className="h-3.5 w-3.5" />Dùng video biểu cảm của Sếp<input type="file" accept="video/*" className="hidden" onChange={async (e) => { const [up] = await uploadFiles(e.target.files, /\.(mp4|mov|m4v|webm)$/i); if (up) setV({ drivingPath: up.path, drivingName: up.name }); }} /></label>
                    <Field label={`Độ dài clip: ${form.video.seconds} giây`} hint="M2 cần khoảng 1 phút cho mỗi giây video"><input type="range" min={3} max={15} value={form.video.seconds} onChange={(e) => setV({ seconds: e.target.value })} className="w-full" /></Field>
                  </div>
                  {!form.video.drivingPath && <video key={form.video.driving} src={`/v1/video-ai/driving/${form.video.driving}`} muted autoPlay loop playsInline className="h-full max-h-56 w-full rounded-xl bg-black object-contain" />}
                </div>
                <Field label="Lồng giọng đọc (tuỳ chọn)" hint="Giọng Edge TTS; clip kéo dài theo lời đọc"><textarea rows={2} className={inputCls} value={form.video.voiceText} onChange={(e) => setV({ voiceText: e.target.value })} placeholder="Chào cả nhà, hôm nay chị review…" /></Field>
                {form.video.voiceText && <select className={inputCls} value={form.video.voiceName} onChange={(e) => setV({ voiceName: e.target.value })}>{(vai.data?.tts?.voices ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>}
              </div>
            )}
            <Field label={engine === "news" ? "Link bài báo + ghi chú" : "Thông tin sản phẩm / chủ đề / kịch bản"} hint={engine === "news" && form.brief && !/https?:\/\//.test(form.brief) ? "Cần có link bài báo (http…)" : undefined}><textarea rows={6} className={inputCls} value={form.brief} onChange={(e) => set({ brief: e.target.value })} placeholder={engine === "news" ? "https://vnexpress.net/... \nGhi chú (tuỳ chọn): giọng nữ, nhấn mạnh số liệu..." : "Giá, vị, điểm nổi bật, ưu đãi, link affiliate… hoặc chủ đề phim + thông điệp"} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Giọng"><input className={inputCls} value={form.voice} onChange={(e) => set({ voice: e.target.value })} placeholder="Nữ, miền Bắc, xưng chị" /></Field>
              <Field label="Tiêu đề hook"><input className={inputCls} value={form.hookTitle} onChange={(e) => set({ hookTitle: e.target.value })} /></Field>
              <Field label="CTA trên video"><input className={inputCls} value={form.cta} onChange={(e) => set({ cta: e.target.value })} placeholder="Bấm giỏ hàng ngay" /></Field>
            </div>
            <ImageSlots slots={tool?.slots ?? []} images={form.images} onUpload={upload} onRemove={(path) => set({ images: form.images.filter((i: any) => i.path !== path) })}
              onRole={(path, role) => set({ images: form.images.map((i: any) => (i.path === path ? { ...i, role } : i)) })}
              note={engine === "flow" && form.tool === "review-do-an-vat" ? "Ô nào để trống thì AI tự tạo ảnh trên Flow. Ảnh Sếp tải lên được dùng đúng ô, giữ nguyên khuôn mặt nhân vật chính ở mọi cảnh." : form.tool === "review-nha-hang" ? "Bắt buộc ảnh THẬT mặt tiền và không gian (cảnh 1 ngoài quán, các cảnh sau trong quán) — không để AI vẽ quán không có thật. Ghi tên, địa chỉ, món/dịch vụ, giá, giờ mở cửa, ưu đãi trong phần thông tin; mỗi đoạn 8 giây." : form.tool === "review-gia-dung" ? "Bắt buộc ảnh thật của sản phẩm. Ghi đủ công dụng, thông số, giá/ưu đãi và tên thương hiệu/shop trong phần thông tin — Tool viết kịch bản chỉ từ đó. Không có ảnh KOC thì AI tự sinh người review; 5 cảnh × 8 giây." : form.tool === "koc-thoi-trang-nu" ? "Bắt buộc ảnh thật của sản phẩm (SP1) để giữ đúng màu, hoạ tiết. Thiếu ảnh KOC hoặc bối cảnh thì AI tự tạo; Tool dựng ảnh KOC mặc đồ trong bối cảnh rồi 5 góc selfie, 6 cảnh × 8 giây." : form.tool === "nhan-hieu" ? "Bắt buộc ảnh chân dung rõ mặt của chính người đứng tên nhân hiệu — AI giữ đúng gương mặt ở mọi cảnh. Giọng được khóa bằng một mẫu giọng (nam/nữ theo ô Giọng) để các cảnh nói cùng một giọng." : form.tool === "nguoi-que-so-sanh" ? "Ảnh người que quyết định nét vẽ của cả video (thiếu thì AI tự tạo người que trên Flow). Mỗi cảnh chỉ dùng 3 ảnh: người que + sản phẩm A + sản phẩm B." : form.tool === "review-thoi-trang" ? "Nên có ảnh thật của sản phẩm để AI giữ đúng màu, logo, đường may. Thiếu ảnh người mẫu thì AI tự tạo; Tool thử đồ AI rồi giữ nguyên mặt người mẫu ở mọi cảnh (mỗi cảnh 8 giây)." : engine === "flow" ? "Ảnh Sếp tải lên được dùng làm tham chiếu cho đúng vai trò; nhân vật chính giữ nguyên khuôn mặt ở mọi cảnh." : undefined}
              extras={engine === "flow"} />
            <div>
              <p className="mb-2 text-sm font-medium">Đăng nháp lên kênh (sau khi duyệt)</p>
              <div className="flex gap-2">{CHANNELS.map((c) => (
                <button key={c} onClick={() => set({ channels: form.channels.includes(c) ? form.channels.filter((x: string) => x !== c) : [...form.channels, c] })} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", form.channels.includes(c) ? "border-blue-500 bg-blue-500/10" : "border-line")}><PlatformIcon p={c} size={14} />{c}</button>
              ))}</div>
            </div>
            <div className="flex justify-end"><Button variant="primary" icon={Play} disabled={!ready || !form.title || (engine !== "liveportrait" && form.brief.length < 5) || (engine === "news" && !/https?:\/\/\S+/.test(form.brief)) || !form.channels.length || (tool?.slots ?? []).some((sl: any) => sl.required && !form.images.some((i: any) => i.role === sl.role)) || (engine === "moneyprinter" && form.video.source === "flow" && !form.video.flowJobId) || (engine === "moneyprinter" && form.video.source === "local" && !form.video.materials.length)} onClick={() => setConfirm(true)}>Bắt đầu sản xuất</Button></div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Các lần sản xuất">
            {!jobs.data ? <Loading /> : !jobs.data.length ? <Empty>Chưa có video nào.</Empty> : (
              <div className="space-y-1">
                {(allJobs ? jobs.data : jobs.data.slice(0, 3)).map((j) => (
                  <button key={j.id} onClick={() => setSelected(j.id)} className={cx("flex w-full items-center justify-between gap-2 rounded-xl p-2.5 text-left", j.id === current ? "bg-blue-500/10" : "hover:bg-soft")}>
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{j.title}</p><p className="truncate text-xs text-muted">{j.step ?? j.error ?? ""} · {timeAgo(j.created_at)}</p></div>
                    <Badge tone={STATUS[j.status]?.[1]}>{j.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}{STATUS[j.status]?.[0] ?? j.status}</Badge>
                  </button>
                ))}
                {jobs.data.length > 3 && (
                  <button onClick={() => setAllJobs((v) => !v)} className="w-full rounded-xl p-2 text-center text-xs font-medium text-blue-600 hover:bg-soft">
                    {allJobs ? "Thu gọn" : `Xem tất cả (${jobs.data.length})`}
                  </button>
                )}
              </div>
            )}
          </Card>
          {current && <JobDetail id={current} />}
        </div>
      </div>

      <VideoAiTools status={vai.data} onChanged={vai.reload} upload={uploadFiles} />

      <Modal open={confirm} onClose={() => setConfirm(false)} title={engine === "flow" ? "Xác nhận sản xuất video trên Flow" : "Xác nhận sản xuất video"} footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" loading={busy} onClick={start}>Bắt đầu</Button></>}>
        <div className="space-y-2 text-sm">
          <p><b>{tool?.label}</b> · {form.title}</p>
          {engine !== "flow" ? (
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Chạy trên máy Sếp, <b>không tốn tín dụng Flow</b>, không cần bấm gì (khoảng {tool?.minutes} phút{engine === "liveportrait" ? `; ${form.video.seconds} giây clip` : ""}). Có thông báo khi xong.</li>
              {engine === "news" ? <li>Claude CLI đọc bài, viết lời đọc (không bịa số liệu, ghi nguồn báo + ảnh), tạo giọng Việt, phụ đề karaoke, đồ hoạ Remotion, chuẩn âm thanh -14 LUFS → Review → hộp Duyệt → đăng bản nháp lên {form.channels.join(", ")} sau khi duyệt.</li>
                : engine === "moneyprinter" ? <li>Claude CLI viết lời đọc{form.video.scriptReady ? " (giữ nguyên lời Sếp)" : ""}, MoneyPrinterTurbo ghép cảnh + giọng Việt + phụ đề → Review → hộp Duyệt → đăng bản nháp lên {form.channels.join(", ")} sau khi duyệt.</li>
                : <li>Clip cử động vào thư viện video (dùng làm đoạn mở đầu / chèn vào video khác), không tự đăng.</li>}
            </ul>
          ) : (
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Hệ thống <b>tự chạy ngầm, không cần Sếp bấm gì</b>: AI mở Tool <b>{tool?.label}</b> trong Chrome Flow (tài khoản {settings.data?.chromeProfileEmail ?? settings.data?.chromeProfileName ?? "đã chọn"}), chạy đủ các bước Cấu hình → Khung chủ → Kịch bản → Storyboard → Sản xuất, tải clip, ghép + chèn phụ đề (khoảng {tool?.minutes ?? 40} phút). Chỉ có thông báo khi video đã xong.</li>
            <li>Mỗi lần tạo cảnh tốn tín dụng Google Flow (tối đa 3 lần làm lại mỗi cảnh).</li>
            <li>Video thành phẩm vào hộp Duyệt; chỉ sau khi duyệt mới đăng <b>bản nháp</b> lên {form.channels.join(", ")}.</li>
          </ul>
          )}
        </div>
      </Modal>
      <BrowserPicker open={pickBrowser} current={settings.data} onClose={() => setPickBrowser(false)} onSaved={() => { setPickBrowser(false); settings.reload(); }} />
    </div>
  );
}

function JobDetail({ id }: { id: string }) {
  const { data: j, reload } = useApi<any>(`creative/jobs/${id}`, ["creative.", "approval.", "post."]);
  const toast = useToast();
  const elapsed = useMemo(() => (j?.started_at ? Math.round(((j.ended_at ? new Date(j.ended_at).getTime() : Date.now()) - new Date(j.started_at).getTime()) / 60000) : null), [j]);
  if (!j) return <Loading />;
  const cancel = async () => { try { await api.post(`creative/jobs/${id}/cancel`); toast("Đã hủy"); reload(); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <Card title={j.title} action={["queued", "running"].includes(j.status) && <Button size="sm" variant="danger" icon={Square} onClick={cancel}>Dừng</Button>}>
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[j.status]?.[1]}>{j.tool === "portrait" && j.status === "done" ? "Xong · trong thư viện video" : STATUS[j.status]?.[0]}</Badge>{elapsed != null && <span className="text-xs text-muted">{elapsed} phút</span>}{j.model && <span className="text-xs text-muted">· {j.model}</span>}</p>
        {j.error && <p className="rounded-xl bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">{j.error}</p>}
        {j.asset && <video src={`/v1/media/${j.asset.id}`} controls className="mx-auto max-h-[480px] rounded-xl bg-black" />}
        {j.asset && <p className="text-xs text-muted">{j.asset.duration?.toFixed(1)}s · {j.asset.width}x{j.asset.height} · <a className="text-blue-600" href={`/v1/media/${j.asset.id}?download=1`}>Tải MP4</a></p>}
        {j.result?.caption && <div className="rounded-xl bg-soft p-3 text-xs"><p className="mb-1 font-semibold">Caption</p><p className="whitespace-pre-wrap">{j.result.caption}</p></div>}
        {j.result?.redoneScenes?.length > 0 && <p className="text-xs text-muted">Cảnh làm lại: {j.result.redoneScenes.map((r: any) => `#${r.scene} (${r.reason})`).join("; ")}</p>}
        {j.approval?.status === "pending" && <Link to={`/approvals?id=${j.approval.id}`}><Button size="sm" variant="primary">Duyệt video →</Button></Link>}
        {j.drafts?.length > 0 && (
          <div className="space-y-1">{j.drafts.map((d: any) => <p key={d.id} className="flex items-center gap-2 text-xs"><PlatformIcon p={d.platform} size={14} />{d.name}: {d.status === "draft_uploaded" ? (d.simulated ? <Badge tone="amber">nháp mô phỏng · chưa lên kênh thật</Badge> : <a href={d.draft_url} target="_blank" rel="noreferrer" className="text-blue-600">đã lên nháp</a>) : d.status}{d.error ? ` · ${d.error}` : ""}</p>)}</div>
        )}
        {(j.log ?? []).length > 0 && (
          <details open={j.status === "running"}>
            <summary className="cursor-pointer text-xs font-medium">Nhật ký agent ({j.log.length} bước)</summary>
            <ol className="mt-2 max-h-72 space-y-1 overflow-auto text-[11px] scroll-thin">{[...j.log].reverse().slice(0, 60).map((s: any, i: number) => <li key={i} className={s.kind === "text" ? "text-ink" : "font-mono text-muted"}>{new Date(s.at).toLocaleTimeString("vi-VN")} · {s.text}</li>)}</ol>
          </details>
        )}
      </div>
    </Card>
  );
}

export function BrowserPicker({ open, current, onClose, onSaved }: { open: boolean; current: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ profiles: any[] } | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { found: boolean; text: string }>>({});
  const load = async () => { try { setData(await api.get("creative/chrome-profiles")); } catch (e: any) { toast(e.message, "err"); } };
  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (p: any) => `${p.channel}/${p.dir}`;
  const act = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { return await fn(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } };
  const choose = (p: any) => act(`c:${key(p)}`, async () => {
    await api.put("creative/settings", { chromeChannel: p.channel, chromeProfileDir: p.dir, chromeProfileName: p.name, chromeProfileEmail: p.email });
    toast(`Đã chọn profile "${p.name}" — đang nối đăng nhập vào Chrome Flow…`, "info");
    onSaved();
    const r = await api.post("creative/chrome-profiles/verify", { channel: p.channel, dir: p.dir });
    setChecks((c) => ({ ...c, [key(p)]: { found: r.found, text: r.found ? `Chrome Flow đã đăng nhập ${r.accountEmail}` : r.error } }));
    toast(r.found ? `Chrome Flow sẵn sàng (${r.accountEmail})` : r.error, r.found ? "ok" : "err");
  });
  const openP = (p: any) => act(`flow:${key(p)}`, async () => {
    await api.post("creative/chrome-profiles/open", { channel: p.channel, dir: p.dir, target: "flow" });
    toast(`Đã mở Flow trong profile "${p.name}"`);
  });
  const list = (data?.profiles ?? []).filter((p) => !search || `${p.name} ${p.email ?? ""} ${p.googleName ?? ""} ${p.dir}`.toLowerCase().includes(search.toLowerCase()));
  const isCurrent = (p: any) => current?.chromeChannel === p.channel && current?.chromeProfileDir === p.dir;

  return (
    <Modal open={open} onClose={onClose} wide title="Chọn profile Chrome dùng cho Google Flow">
      <div className="space-y-3">
        <p className="text-sm text-muted">Tất cả profile Chrome trên máy này. Chọn profile <b className="text-ink">đang đăng nhập tài khoản Google có Flow</b> — hệ thống chép đăng nhập đó sang Chrome Flow (cửa sổ Chrome riêng mà AI điều khiển), không cần cài extension.</p>
        <input className={inputCls} placeholder="Tìm theo tên profile hoặc email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!data ? <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Đang đọc profile Chrome…</p> : list.length === 0 ? <Empty>Không thấy profile nào.</Empty> : (
          <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1 scroll-thin">
            {list.map((p) => {
              const k = key(p);
              const chk = checks[k];
              return (
                <div key={k} className={cx("rounded-xl border p-3", isCurrent(p) ? "border-blue-500 bg-blue-500/5" : "border-line")}>
                  <div className="flex items-center gap-3">
                    {p.hasAvatar
                      ? <img src={`/v1/creative/chrome-profiles/avatar?channel=${encodeURIComponent(p.channel)}&dir=${encodeURIComponent(p.dir)}`} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                      : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-soft text-sm font-bold text-muted">{p.name.slice(0, 1).toUpperCase()}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{p.name}{isCurrent(p) && <Badge tone="blue">Đang dùng cho Flow</Badge>}{p.lastUsed && <Badge>Mở gần nhất</Badge>}</p>
                      <p className="truncate text-xs text-muted">{p.email ?? "Chưa đăng nhập Google"} · {p.channelName} · {p.dir}</p>
                    </div>
                    {p.email ? <Badge tone="green">Đã đăng nhập Google</Badge> : <Badge tone="amber">Chưa đăng nhập Google</Badge>}
                  </div>
                  {chk && <p className={cx("mt-2 text-xs", chk.found ? "text-emerald-600" : "text-rose-600")}>{chk.text}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant={isCurrent(p) ? "secondary" : "primary"} loading={busy === `c:${k}`} onClick={() => choose(p)}>{isCurrent(p) ? "Đã chọn" : "Chọn profile này"}</Button>
                    <Button size="sm" loading={busy === `flow:${k}`} onClick={() => openP(p)}>Mở Flow trong profile</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{data ? `${data.profiles.length} profile · ${data.profiles.filter((p) => p.email).length} profile đã đăng nhập Google` : ""}</span>
          <Button size="sm" variant="ghost" onClick={load}>Quét lại</Button>
        </div>
        <p className="rounded-xl bg-soft p-3 text-xs text-muted">Bấm <b>Chọn profile này</b>: vài giây sau Chrome Flow có sẵn đăng nhập Google của profile (không cần bấm gì). Nếu Google không nhận bản sao đăng nhập, Chrome Flow tự mở trang đăng nhập — Sếp đăng nhập 1 lần, các lần sau chạy ngầm hoàn toàn.</p>
      </div>
    </Modal>
  );
}

/** Local video AI: status of each tool, stock-footage keys, voice-over test, subtitles from a video. */
function VideoAiTools({ status, onChanged, upload }: { status: any; onChanged: () => void; upload: (f: FileList | null, accept: RegExp) => Promise<{ path: string; name: string }[]> }) {
  const toast = useToast();
  const [keys, setKeys] = useState({ pexels: "", pixabay: "" });
  const [tts, setTts] = useState({ text: "Chào cả nhà, đây là giọng đọc thử của Agentic AI.", voice: "vi-VN-HoaiMyNeural-Female", url: "", busy: false });
  const [stt, setStt] = useState<{ busy: boolean; text?: string; srt?: string; name?: string }>({ busy: false });
  if (!status) return null;
  const Row = ({ ok, name, desc }: { ok: boolean; name: string; desc: string }) => (
    <div className="flex items-start gap-2 rounded-xl bg-soft p-2.5"><span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} /><div><p className="text-sm font-medium">{name}</p><p className="text-[11px] text-muted">{desc}</p></div></div>
  );
  const saveKeys = async () => {
    try { await api.put("video-ai/stock-keys", { ...(keys.pexels ? { pexels: keys.pexels } : {}), ...(keys.pixabay ? { pixabay: keys.pixabay } : {}) }); setKeys({ pexels: "", pixabay: "" }); toast("Đã lưu khóa kho cảnh"); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  const speak = async () => {
    setTts((t) => ({ ...t, busy: true }));
    try { const r = await api.post("video-ai/tts", { text: tts.text, voice: tts.voice }); setTts((t) => ({ ...t, url: `/v1/video-ai/file?path=${encodeURIComponent(r.mp3)}`, busy: false })); } catch (e: any) { toast(e.message, "err"); setTts((t) => ({ ...t, busy: false })); }
  };
  const transcribeFile = async (files: FileList | null) => {
    const [up] = await upload(files, /\.(mp4|mov|m4v|webm|mp3|wav|m4a)$/i);
    if (!up) return;
    setStt({ busy: true, name: up.name });
    try { const r = await api.post("video-ai/transcribe", { path: up.path }); setStt({ busy: false, text: r.text, srt: r.srt, name: up.name }); } catch (e: any) { toast(e.message, "err"); setStt({ busy: false }); }
  };
  return (
    <Card title="Công cụ video AI trên máy">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <Row ok={status.moneyprinter.installed} name="MoneyPrinterTurbo" desc={`Video tự động từ cảnh có sẵn · kho Pexels: ${status.moneyprinter.pexels.length ? status.moneyprinter.pexels.join(", ") : "chưa có khóa"}`} />
          <Row ok={status.liveportrait.installed && status.liveportrait.mediapipe} name="LivePortrait + MediaPipe" desc={`Ảnh chân dung cử động · ${status.liveportrait.presets.length} video biểu cảm mẫu · dò mặt MediaPipe (dùng thương mại được)`} />
          <Row ok={status.whisper.installed} name="faster-whisper" desc="Nhận dạng lời thoại tiếng Việt, xuất phụ đề .srt" />
          <Row ok={!!status.remotion?.installed} name="Remotion" desc="Dựng video tin tức từ link bài báo (skill news-to-video) · phụ đề karaoke, đồ hoạ động" />
          <Row ok={status.tts.installed} name="Edge TTS (thay fish-speech)" desc="Giọng Việt Hoài My / Nam Minh, dùng thương mại được" />
          <p className="text-[11px] text-muted">fish-speech không cài: {status.fishSpeech.note}{status.freeDiskGB != null ? ` · Đĩa còn ${status.freeDiskGB} GB.` : ""}</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Khóa kho cảnh quay (miễn phí)</p>
          <p className="text-[11px] text-muted">Tạo khóa tại pexels.com/api hoặc pixabay.com/api/docs rồi dán vào đây. Khóa chỉ lưu trên máy này.</p>
          <input type="password" className={inputCls} placeholder={status.moneyprinter.pexels.length ? `Pexels: ${status.moneyprinter.pexels[0]} (dán khóa mới để thay)` : "Khóa Pexels"} value={keys.pexels} onChange={(e) => setKeys({ ...keys, pexels: e.target.value })} />
          <input type="password" className={inputCls} placeholder={status.moneyprinter.pixabay.length ? `Pixabay: ${status.moneyprinter.pixabay[0]}` : "Khóa Pixabay (tuỳ chọn)"} value={keys.pixabay} onChange={(e) => setKeys({ ...keys, pixabay: e.target.value })} />
          <Button size="sm" disabled={!keys.pexels && !keys.pixabay} onClick={saveKeys}>Lưu khóa</Button>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Thử giọng đọc</p>
            <textarea rows={2} className={inputCls} value={tts.text} onChange={(e) => setTts({ ...tts, text: e.target.value })} />
            <div className="flex gap-2"><select className={cx(inputCls, "min-w-0 flex-1")} value={tts.voice} onChange={(e) => setTts({ ...tts, voice: e.target.value })}>{status.tts.voices.map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select><Button size="sm" loading={tts.busy} onClick={speak}>Đọc</Button></div>
            {tts.url && <audio src={tts.url} controls autoPlay className="w-full" />}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Tạo phụ đề từ video</p>
            <label className={cx("flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:bg-soft", stt.busy && "pointer-events-none opacity-60")}>{stt.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}{stt.busy ? `Đang nghe ${stt.name}…` : "Chọn video / âm thanh"}<input type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => transcribeFile(e.target.files)} /></label>
            {stt.text && <div className="rounded-xl bg-soft p-2 text-xs"><p className="line-clamp-4">{stt.text}</p><a className="text-blue-600" href={`/v1/video-ai/file?path=${encodeURIComponent(stt.srt!)}&download=1`}>Tải phụ đề .srt</a></div>}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** One upload card per role the tool needs (main character, product…) + optional extra reference images. */
function ImageSlots({ slots, images, onUpload, onRemove, onRole, note, extras }: {
  slots: { role: string; label: string; hint: string; required?: boolean }[]; images: any[]; note?: string; extras: boolean;
  onUpload: (f: FileList | File[] | null, role?: string) => void; onRemove: (path: string) => void; onRole: (path: string, role: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const slotRoles = new Set(slots.map((s) => s.role));
  const others = images.filter((i) => !slotRoles.has(i.role));
  if (!slots.length && !extras) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Ảnh cho video {note && <span className="text-xs font-normal text-muted">— {note}</span>}</p>
      {slots.length > 0 && (
        <div className={cx("grid gap-2.5", slots.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {slots.map((sl) => {
            const img = images.find((i) => i.role === sl.role);
            return (
              <div key={sl.role}
                onDragOver={(e) => { e.preventDefault(); setOver(sl.role); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); onUpload(e.dataTransfer.files, sl.role); }}
                className={cx("group relative flex flex-col overflow-hidden rounded-xl border-2 border-dashed text-center transition", slots.length === 3 ? "aspect-[3/4]" : "aspect-[4/3]", over === sl.role ? "border-blue-500 bg-blue-500/5" : img ? "border-transparent" : "border-line hover:border-blue-400 hover:bg-soft")}>
                {img ? (
                  <>
                    {img.preview ? <img src={img.preview} alt={sl.label} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center bg-soft p-2 text-[11px] text-muted">{img.name}</div>}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2 text-left text-white">
                      <p className="text-[11px] font-semibold">{sl.label}</p>
                      <div className="mt-1 flex gap-1.5 opacity-90">
                        <label className="cursor-pointer rounded-md bg-white/20 px-2 py-0.5 text-[10px] hover:bg-white/30">Đổi ảnh<input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files, sl.role)} /></label>
                        <button onClick={() => onRemove(img.path)} className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] hover:bg-rose-500/80">Xóa</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1.5 p-2">
                    <ImagePlus className="h-6 w-6 text-blue-500" />
                    <span className="text-xs font-semibold text-ink">{sl.label}</span>
                    {sl.required ? <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600">bắt buộc</span> : null}
                    <span className="text-[10px] leading-tight text-muted">{sl.hint}</span>
                    <span className="text-[10px] text-blue-600">Bấm hoặc kéo ảnh vào</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files, sl.role)} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
      {extras && (
        <div className="flex flex-wrap items-center gap-2">
          {others.map((im) => (
            <div key={im.path} className="flex items-center gap-2 rounded-xl border border-line px-2 py-1.5 text-xs">
              {im.preview && <img src={im.preview} alt="" className="h-7 w-7 rounded object-cover" />}
              <select className="bg-transparent" value={im.role} onChange={(e) => onRole(im.path, e.target.value)}>{["Ảnh tham khảo khác", ...ROLES].map((r) => <option key={r}>{r}</option>)}</select>
              <span className="max-w-[110px] truncate text-muted">{im.name}</span>
              <button onClick={() => onRemove(im.path)}><Trash2 className="h-3.5 w-3.5 text-muted" /></button>
            </div>
          ))}
          {images.length < 8 && <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:bg-soft"><ImagePlus className="h-4 w-4" />Ảnh tham khảo khác<input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} /></label>}
        </div>
      )}
    </div>
  );
}

/** Kịch bản đã duyệt → đúng skill tạo video (chọn tool + lời đọc sạch ở máy chủ). Flow tốn tín dụng → chỉ chạy khi Sếp bấm. */
function ScriptsToVideo() {
  const list = useApi<any[]>("video-scripts", ["creative.", "approval.", "task."]);
  const [ask, setAsk] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const plans = (list.data ?? []).filter((p) => !p.error && !(p.job && p.job.status === "done"));
  if (!list.data || !plans.length) return null;
  const run = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const r = await api.post(`content/${ask.contentId}/make-video`);
      toast(r.already ? "Kịch bản này đang có video chạy rồi" : `Đã bắt đầu tạo video bằng ${r.tool} — xong sẽ báo và gửi Sếp duyệt`);
      setAsk(null); list.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2">Kịch bản đã duyệt → tạo video <Badge tone="blue">{plans.length}</Badge></span>}>
      <p className="-mt-1 mb-3 text-xs text-muted">Hệ thống tự chọn skill hợp với từng kịch bản và chỉ đưa lời đọc đã duyệt vào video (bỏ mốc cảnh, ghi chú nội bộ). Video xong dùng đúng Caption đã duyệt và gắn lại vào kịch bản gốc.</p>
      <div className="divide-y divide-line">
        {plans.map((p) => {
          const Icon = TOOL_ICON[p.tool] ?? Film;
          const running = p.job && ["queued", "running"].includes(p.job.status);
          return (
            <div key={p.contentId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{p.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted"><Icon className="h-3.5 w-3.5" /><b className="text-ink">{p.toolLabel}</b> · {p.scenes} cảnh · ~{p.durationSec}s{p.paidCredits ? " · tốn tín dụng Flow" : " · chạy trên máy, không tốn tín dụng"}</p>
                <p className="mt-0.5 text-xs text-muted">{p.reason}</p>
                {p.missing?.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">{p.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>}
                {running && <p className="mt-1 text-xs"><Badge tone="blue">{STATUS[p.job.status]?.[0] ?? p.job.status}</Badge> {p.job.step}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setParams({ from: p.contentId })}>Mở để chỉnh</Button>
                <Button size="sm" variant="primary" icon={Play} disabled={Boolean(running) || p.missing?.length > 0} onClick={() => setAsk(p)}>{running ? "Đang tạo" : "Tạo video"}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={Boolean(ask)} onClose={() => setAsk(null)} title="Tạo video từ kịch bản?" footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Hủy</Button><Button variant="primary" loading={busy} onClick={run}>Bắt đầu</Button></>}>
        {ask && <div className="space-y-2 text-sm text-ink">
          <p><b>{ask.title}</b></p>
          <p>Skill: <b>{ask.toolLabel}</b> · {ask.scenes} cảnh · khoảng {ask.durationSec} giây · mất khoảng {ask.minutes} phút.</p>
          {ask.paidCredits && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Chạy trên Google Flow bằng Chrome Flow — <b>tốn tín dụng Flow</b> của tài khoản đã chọn. Chạy 1 video/lần, video sau xếp hàng.</p>}
          <p className="text-xs text-muted">Xong sẽ có thông báo; video vào "Duyệt & Phê duyệt" để Sếp xem trước khi đăng.</p>
        </div>}
      </Modal>
    </Card>
  );
}
