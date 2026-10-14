import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clapperboard, CookingPot, Footprints, Layers, Newspaper, Scissors, UserRound, Wand2, ExternalLink, Film, Globe, ImagePlus, Loader2, Mic, PersonStanding, Play, Shirt, Sparkles, Square, Store, Trash2, UtensilsCrossed } from "lucide-react";
import { api, apiUrl, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Fold, Loading, Modal, MoreToggle, PageHeader, PlatformIcon, cx, inputCls, useToast } from "../components/ui";

/** Làm thủ công trên Flow · Veo 3 (flow-manual.ts): kịch bản đã duyệt + ảnh khuôn mặt, chỉ chạy bằng Claude in Chrome. */
const MANUAL_TOOL = "flow-thu-cong";
const TOOL_ICON: Record<string, any> = { [MANUAL_TOOL]: Layers, "review-do-an-vat": UtensilsCrossed, "review-thoi-trang": Shirt, "nguoi-que-so-sanh": PersonStanding, "nhan-hieu": Mic, "koc-thoi-trang-nu": Sparkles, "review-gia-dung": CookingPot, "review-nha-hang": Store, "cooking-director": Clapperboard, cinematic: Film, "auto-video": Wand2, "news-video": Newspaper, "edit-source": Scissors, "nhan-hieu-dao-ly": Footprints, portrait: UserRound };
const STATUS: Record<string, [string, any]> = {
  queued: ["Chờ trình duyệt", "gray"], running: ["Đang sản xuất", "blue"], done: ["Xong, chờ duyệt", "green"],
  approved: ["Đã duyệt", "blue"], drafted: ["Đã lên nháp kênh", "green"],
  failed: ["Lỗi", "red"], blocked: ["Bị chặn", "amber"], cancelled: ["Đã hủy", "gray"],
};
// Order = default role for the 1st, 2nd… uploaded image. Names map onto the Tool's slots (A nhân vật, B bao bì, I bên trong, E bối cảnh).
const ROLES = ["Bao bì / sản phẩm", "Nhân vật / người review", "Bên trong sản phẩm", "Bối cảnh / góc bếp", "Nhân vật 2", "Phong cách"];
const CHANNELS = ["tiktok", "facebook", "instagram"];

/** Gửi 1 video lớn thẳng dạng luồng (không base64) kèm % tiến độ; trả về đường dẫn trên máy chủ. */
const VIDEO_FILE_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
function putVideoStream(f: File, onPct: (n: number | null) => void): Promise<{ path: string }> {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("PUT", apiUrl(`/v1/uploads/stream?name=${encodeURIComponent(f.name)}`));
    x.setRequestHeader("content-type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { try { const j = JSON.parse(x.responseText); x.status < 300 ? res(j) : rej(new Error(j.message ?? `Lỗi ${x.status}`)); } catch { rej(new Error(`Lỗi ${x.status}`)); } };
    x.onerror = () => rej(new Error("Mất kết nối khi tải lên"));
    x.send(f);
  }).finally(() => onPct(null)) as Promise<{ path: string }>;
}
const EDIT_STYLE_OPTIONS = [["dynamic", "Năng động — nhịp nhanh, zoom mạnh (TikTok/Reels)"], ["smooth", "Mượt, sang — chuyển cảnh nhẹ"], ["clean", "Gọn, chuyên nghiệp"]] as const;

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
    tool: "review-do-an-vat", title: "", brand: "other", product: "", brief: "", durationSec: 48, veoModel: "Veo 3.1 - Fast", voice: "", hookTitle: "", cta: "", channels: [] as string[], images: [] as { path: string; role: string; name: string }[],
    // ảnh theo ô (vai trò) + ảnh tham khảo khác; local engines (Video tự động / Ảnh cử động)
    video: { source: "flow", flowJobId: "", scriptReady: false, terms: "", voiceName: "vi-VN-HoaiMyNeural-Female", voiceRate: 1, bgm: "random", aspect: "9:16", clipDuration: 4, driving: "d12.mp4", drivingPath: "", drivingName: "", voiceText: "", seconds: 6, materials: [] as { path: string; name: string }[] },
  });
  const vai = useApi<any>("video-ai/status");
  const dnaInfo = useApi<any>("dna");
  const ownBrand = dnaInfo.data?.data?.company?.brand || dnaInfo.data?.data?.company?.name || "Thương hiệu của Sếp";
  const dnaProducts: any[] = (dnaInfo.data?.data?.products ?? []).filter((p: any) => p?.name);
  const setV = (p: any) => setForm((f: any) => ({ ...f, video: { ...f.video, ...p } }));
  const [confirm, setConfirm] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  /** Video gốc (có thể vài GB): gửi thẳng dạng luồng, có % tiến độ — không qua base64. */
  const uploadSources = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!/\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav)$/i.test(f.name)) { toast(`${f.name}: chỉ nhận video/âm thanh`, "err"); continue; }
      try {
        const r = await putVideoStream(f, setUpPct);
        setForm((x: any) => ({ ...x, video: { ...x.video, materials: [...x.video.materials, { path: r.path, name: `${f.name} · ${(f.size / 1048576).toFixed(0)} MB` }] } }));
      } catch (e: any) { toast(`${f.name}: ${e.message}`, "err"); }
    }
  };
  const [allJobs, setAllJobs] = useState(false); // list shows the 3 latest runs unless expanded
  const [allTools, setAllTools] = useState(false); // tool picker shows 6 (always incl. the selected one) unless expanded
  const [busy, setBusy] = useState(false);
  const set = (p: any) => setForm((f: any) => ({ ...f, ...p }));

  /** Làm thủ công trên Flow: lời thoại, hook, CTA lấy từ kịch bản đã duyệt — chỉ còn thiếu ảnh khuôn mặt. */
  const pickManualScript = (contentId: string) => {
    if (!contentId) { set({ sourceContentId: undefined, brief: "", manualScenes: undefined, manualOk: false }); return; }
    Promise.all([api.get(`content/${contentId}/video-plan`), api.get(`content/${contentId}/flow-manual-preview`)]).then(([p, m]) => {
      setForm((f: any) => ({
        ...f, tool: MANUAL_TOOL, sourceContentId: contentId, manualScenes: undefined, title: String(m.title).slice(0, 120), brand: p.input?.brand ?? f.brand,
        brief: m.scenes.map((s: any) => s.voice).join("\n").slice(0, 6000), hookTitle: m.hookTitle, cta: m.cta, durationSec: m.durationSec,
        images: f.images.filter((i: any) => i.role === "Khuôn mặt nhân vật"),
      }));
    }).catch((e) => toast(e.message, "err"));
  };

  // Prefill from an approved video script (Nội dung → "Sản xuất trên Flow")
  useEffect(() => {
    const from = params.get("from");
    if (!from) return;
    if (params.get("manual")) { pickManualScript(from); document.getElementById("video-form")?.scrollIntoView({ behavior: "smooth" }); return; }
    // Kịch bản → đúng skill + lời đọc đã làm sạch (script-video.ts), không dán nguyên kịch bản sản xuất.
    api.get(`content/${from}/video-plan`).then((p) => {
      const i = p.input;
      setForm((f: any) => ({
        ...f, tool: i.tool, title: i.title, brief: i.brief, brand: "taki", sourceContentId: i.sourceContentId, product: i.product ?? "", voice: i.voice ?? "",
        hookTitle: i.hookTitle ?? "", cta: i.cta ?? "", durationSec: i.durationSec ?? f.durationSec, // nền tảng đăng: Sếp tự chọn, không lấy sẵn từ kịch bản
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
        : engine === "edit" ? { materials: video.materials.map((m: any) => m.path), aspect: ["9:16", "1:1", "16:9"].includes(video.aspect) ? video.aspect : "9:16", style: video.style ?? "dynamic", music: video.music === "none" ? "none" : "auto" }
        : engine === "liveportrait" ? { driving: video.drivingPath ? undefined : video.driving, drivingPath: video.drivingPath || undefined, voiceText: video.voiceText || undefined, voiceName: video.voiceName, seconds: Number(video.seconds) } : undefined;
      const brief = form.brief.trim().length >= 5 ? form.brief : `${form.title} — ${tool?.label ?? ""}`;
      const slotRoles = new Set((tool?.slots ?? []).map((x: any) => x.role));
      const used = engine === "flow" ? images : images.filter((i: any) => slotRoles.has(i.role)); // local engines use their own slots only
      const j = await api.post("creative/jobs", { ...rest, brief, video: v, durationSec: manual ? undefined : Number(form.durationSec) || undefined, manualScenes: manual ? form.manualScenes : undefined, images: used.map((i: any) => ({ path: i.path, role: i.role })), product: form.product || undefined, voice: form.voice || undefined, hookTitle: form.hookTitle || undefined, cta: form.cta || undefined });
      toast(manual ? "Đã đưa vào hàng đợi. AI lên concept rồi làm từng cảnh trên Flow bằng Claude in Chrome — Sếp sẽ nhận thông báo khi video vào hộp Duyệt." : engine === "flow" ? "Đã đưa vào hàng đợi. Agent chạy ngầm trong Chrome Flow — Sếp sẽ nhận thông báo khi video xong." : "Đã đưa vào hàng đợi — chạy trên máy Sếp, có thông báo khi xong.", "info");
      setConfirm(false);
      setSelected(j.id);
      jobs.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  const tool = tools.data?.find((t) => t.key === form.tool);
  const engine: "flow" | "moneyprinter" | "liveportrait" | "news" | "edit" = tool?.engine ?? "flow";
  const flowDone = (jobs.data ?? []).filter((j: any) => !["auto-video", "portrait", "news-video"].includes(j.tool) && ["done", "approved", "drafted"].includes(j.status));
  const hasBrowser = !!settings.data?.chromeProfileDir;
  const useChrome = settings.data?.engine === "claude-in-chrome";
  const fbAccount = fb.data?.accounts?.includes(settings.data?.chromeProfileEmail) ? settings.data.chromeProfileEmail : fb.data?.accounts?.[0];
  const showFlow = async (state: "normal" | "parked") => { try { await api.post("creative/flow-browser/window", { state }); } catch (e: any) { toast(e.message, "err"); } };
  const login = async () => { try { await api.post("creative/flow-browser/login"); toast("Đã mở Chrome Flow ở trang đăng nhập Google — Sếp đăng nhập 1 lần", "info"); fb.reload(); } catch (e: any) { toast(e.message, "err"); } };
  const cliOk = sys?.llm?.provider === "claude_cli" && sys?.llm?.loggedIn !== false && !sys?.llm?.authError;
  const manual = !!tool?.manual;
  const ready = engine === "flow" ? hasBrowser && cliOk : engine === "moneyprinter" ? cliOk && !!vai.data?.moneyprinter?.installed : engine === "news" ? cliOk && !!vai.data?.remotion?.installed : engine === "edit" ? !!sys?.llm?.enabled && !!vai.data : !!vai.data?.liveportrait?.installed;
  /** Lý do nút "Bắt đầu sản xuất" đang khoá — hiện ngay dưới nút để Sếp biết còn thiếu gì. */
  const whyNot = [
    !ready && (engine === "flow"
      ? (!hasBrowser ? "Chưa chọn profile Chrome có tài khoản Flow (mục Trình duyệt & tài khoản AI)" : "Tài khoản Claude CLI chưa sẵn sàng (mục Trình duyệt & tài khoản AI)")
      : "Công cụ chạy trên máy chưa sẵn sàng (Claude CLI hoặc phần mềm video chưa cài)"),
    manual && !form.sourceContentId && "Chọn kịch bản đã duyệt",
    manual && form.sourceContentId && !form.manualOk && "Kịch bản / phân cảnh chưa hợp lệ — xem thông báo đỏ ở phần kịch bản",
    !form.title && "Nhập tên video",
    !manual && engine !== "liveportrait" && form.brief.length < 5 && "Nhập thông tin sản phẩm / chủ đề / kịch bản",
    engine === "news" && !/https?:\/\/\S+/.test(form.brief) && "Dán link bài báo (http…)",
    !form.channels.length && "Chọn ít nhất 1 nền tảng đăng",
    ...(tool?.slots ?? []).filter((sl: any) => sl.required && !form.images.some((i: any) => i.role === sl.role)).map((sl: any) => `Tải ảnh: ${sl.label}`),
    engine === "moneyprinter" && form.video.source === "flow" && !form.video.flowJobId && "Chọn video Flow để lấy clip",
    engine === "moneyprinter" && form.video.source === "local" && !form.video.materials.length && "Tải clip / ảnh của Sếp",
    engine === "edit" && !form.video.materials.length && "Tải video gốc",
    engine === "edit" && upPct !== null && "Đang tải video lên…",
  ].filter(Boolean) as string[];
  const current = selected ?? jobs.data?.[0]?.id ?? null;
  const setupLoaded = !!settings.data && !!sys;
  const setupOk = hasBrowser && cliOk;
  const toolList = tools.data ?? [];
  const shownTools = allTools || toolList.length <= 6 ? toolList : toolList.slice(0, 6).some((t) => t.key === form.tool) ? toolList.slice(0, 6) : [...toolList.slice(0, 5), ...toolList.filter((t) => t.key === form.tool)];

  return (
    <div className="space-y-6">
      <PageHeader title="Sản xuất video" subtitle="Google Flow (AI tạo cảnh, chạy trong Tool của skill) · AI tự edit từ video gốc Sếp tải lên · Video tự động từ cảnh có sẵn + giọng đọc Việt · Ảnh chân dung cử động — xong thì Review, gửi duyệt và đăng nháp lên kênh." />

      <Fold key={setupLoaded ? (setupOk ? "ok" : "todo") : "loading"} icon={Globe} tone={!setupLoaded ? "gray" : setupOk ? "green" : "amber"} defaultOpen={setupLoaded && !setupOk}
        title="Trình duyệt & tài khoản AI" bodyClass="space-y-3 px-4 pb-4 pt-1"
        summary={!setupLoaded ? "đang kiểm tra…" : setupOk ? `Sẵn sàng · ${settings.data?.chromeProfileName ?? "Chrome"}${settings.data?.chromeProfileEmail ? ` (${settings.data.chromeProfileEmail})` : ""} · ${useChrome ? "Claude in Chrome" : "Chrome Flow"}` : "Cần thiết lập trước khi tạo video — bấm để xem"}>
        <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-sm", ready ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/10")}>
          <Globe className="h-5 w-5" />
          <span>Tài khoản Flow: {settings.data?.chromeProfileDir ? <b>{settings.data.chromeProfileName}{settings.data.chromeProfileEmail ? ` · ${settings.data.chromeProfileEmail}` : ""}</b> : <b className="text-amber-700 dark:text-amber-300">chưa chọn profile</b>}</span>
          <span>· {useChrome ? <>Claude in Chrome: {settings.data?.browserDeviceId ? <Badge tone="green">đã ghép Chrome</Badge> : <Badge tone="amber">cần ghép Chrome</Badge>}</> : <>Chrome Flow: {!fb.data ? "…" : fbAccount ? <Badge tone="green">đã đăng nhập {fbAccount}</Badge> : fb.data.running ? <Badge tone="amber">chưa đăng nhập</Badge> : <Badge>tự mở khi chạy</Badge>}</>}</span>
          <span>· Claude: {sys?.llm?.provider === "claude_cli" ? <Badge tone={cliOk ? "green" : "amber"}>{cliOk ? "tài khoản CLI" : "chưa sẵn sàng"}</Badge> : <Badge tone="amber">cần chế độ tài khoản Claude</Badge>}</span>
          {sys?.llm?.authError && <p className="w-full text-xs text-amber-800 dark:text-amber-300">Chưa chạy được tác vụ AI: {sys.llm.authError}</p>}
          <Button size="sm" onClick={() => setPickBrowser(true)}>{hasBrowser ? "Đổi profile Chrome" : "Chọn profile Chrome"}</Button>
          {!useChrome && fb.data?.running && (fbAccount ? <><Button size="sm" variant="ghost" onClick={() => showFlow("normal")}>Xem Chrome Flow</Button><Button size="sm" variant="ghost" onClick={() => showFlow("parked")}>Cất Chrome Flow</Button></> : <Button size="sm" variant="soft" onClick={login}>Đăng nhập Chrome Flow</Button>)}
          <span className="w-full text-xs text-muted">{useChrome ? "AI dùng tiện ích Claude trong profile Chrome đã chọn. Mở profile đó và giữ tiện ích kết nối khi chạy video." : "Chrome Flow là cửa sổ Chrome riêng mang đăng nhập của profile đã chọn; AI thao tác bên trong Tool Flow."}</span>
        </div>
        <BrowserEngineControl flat current={settings.data} onSaved={() => settings.reload()} />
      </Fold>

      <ScriptsToVideo />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card title="Tạo video mới">
          <div id="video-form" className="scroll-mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 md:max-xl:grid-cols-3">
              {shownTools.map((t) => {
                const Icon = TOOL_ICON[t.key] ?? Film;
                return (
                  <button key={t.key} onClick={() => set({ tool: t.key, durationSec: t.key === "cinematic" ? 60 : t.key === "cooking-director" ? 80 : t.key === "auto-video" ? 30 : t.key === "review-thoi-trang" ? 40 : t.key === "nhan-hieu" ? 50 : t.key === "review-gia-dung" ? 40 : t.key === "review-nha-hang" ? 32 : t.key === "news-video" ? 60 : 48 })} className={cx("flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left", form.tool === t.key ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:bg-soft")}>
                    <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", form.tool === t.key ? "bg-blue-600 text-white" : "bg-blue-500/10 text-blue-600")}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold leading-tight text-ink" title={t.label}>{t.label}</span>
                      <span className="block truncate text-[11px] text-muted">~{t.minutes} phút · {t.engine && t.engine !== "flow" ? "trên máy, không tốn credit" : t.manual ? "Google Flow · Claude in Chrome" : `Google Flow · skill v${t.skillVersion ?? "?"}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {toolList.length > 6 && <div className="-mt-2 flex justify-center"><MoreToggle open={allTools} onClick={() => setAllTools((v) => !v)} more={`Xem tất cả ${toolList.length} công cụ`} /></div>}
            {tool && (
              <div className="space-y-1 rounded-xl bg-soft p-3 text-xs text-muted">
                <p>Cần: {tool.hint}</p>
                {manual
                  ? <p>Không dùng Tool có sẵn: AI tự nghĩ concept hợp kịch bản, chia cảnh 8 giây theo nhịp nói (10 giây ≈ 32–35 chữ), viết prompt ảnh storyboard rồi prompt video Veo 3 từng cảnh, làm trong một dự án Flow mới bằng <b>{useChrome ? "Claude in Chrome" : "Chrome Flow (chạy ngầm)"}</b> — cùng trình duyệt với luồng làm bằng Tool —, tải clip về và hệ thống tự ghép + phụ đề.</p>
                  : engine === "flow"
                  ? (tool.generator
                    ? <p>Làm thẳng trong một project Google Flow (trình tạo video thường), không cần Tool riêng.</p>
                    : <ToolLink tool={tool} onSaved={tools.reload} />)
                  : <p>{engine === "edit" ? "Claude CLI + whisper (nghe lời) + ffmpeg (cắt ghép) + phụ đề tiếng Việt" : engine === "moneyprinter" ? "MoneyPrinterTurbo (MIT) + Claude CLI viết lời + Edge TTS giọng Việt" : engine === "news" ? "Skill news-to-video: Claude CLI + Edge TTS + whisper + Remotion (phụ đề karaoke, đồ hoạ động)" : "LivePortrait (MIT, dò mặt MediaPipe — dùng thương mại được)"} · chạy trên máy Sếp{vai.data && engine !== "edit" && !(engine === "moneyprinter" ? vai.data.moneyprinter.installed : engine === "news" ? vai.data.remotion?.installed : vai.data.liveportrait.installed) ? " · CHƯA CÀI — chạy pnpm video-ai:install" : ""}</p>}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tên video"><input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Review bánh tráng trộn Tây Ninh" /></Field>
              <Field label="Thương hiệu / kênh" hint={form.brand === "taki" ? `Áp DNA ${ownBrand} (giọng, claim cấm)` : `Kênh affiliate/khách: không dùng giọng ${ownBrand}`}>
                <select className={inputCls} value={form.brand} onChange={(e) => set({ brand: e.target.value })}><option value="other">Kênh khác / khách hàng</option><option value="taki">{ownBrand} (áp DNA)</option></select>
              </Field>
              {manual ? (
                // Làm thủ công: chọn đúng sản phẩm trong Mục tiêu & DNA (tên khớp để Review chấm theo dữ kiện của sản phẩm đó).
                <Field label="Sản phẩm" hint={dnaProducts.length ? "Từ Mục tiêu & DNA › Sản phẩm" : "Chưa có sản phẩm — thêm ở Mục tiêu & DNA"}>
                  <select className={inputCls} value={form.product} onChange={(e) => set({ product: e.target.value })}>
                    <option value="">— không gắn sản phẩm —</option>
                    {form.product && !dnaProducts.some((p: any) => p.name === form.product) && <option value={form.product}>{form.product}</option>}
                    {dnaProducts.map((p: any) => <option key={p.key || p.name} value={p.name}>{p.name}{p.price != null ? ` · ${Number(p.price).toLocaleString("vi-VN")}đ` : ""}</option>)}
                  </select>
                </Field>
              ) : <Field label="Sản phẩm"><input className={inputCls} value={form.product} onChange={(e) => set({ product: e.target.value })} /></Field>}
              {engine !== "liveportrait" && !manual && <Field label="Thời lượng (giây)" hint={engine === "flow" ? `${Math.max(1, Math.ceil((Number(form.durationSec) || 8) / 8))} cảnh × 8 giây` : engine === "edit" ? "Độ dài video sau khi cắt" : `~${Math.round((Number(form.durationSec) || 30) * 3)} từ lời đọc`}><input type="number" className={inputCls} value={form.durationSec} onChange={(e) => set({ durationSec: e.target.value })} /></Field>}
              {engine === "flow" && <Field className="sm:col-span-2" label={manual ? "Model video cho từng cảnh" : "Model video (nếu Tool cho chọn)"} hint="Omni 1.1 Flash / Veo Lite rẻ, nhanh · Veo Quality đẹp nhất, tốn credit hơn">
                <select className={inputCls} value={form.veoModel} onChange={(e) => set({ veoModel: e.target.value })}>{["Veo 3.1 - Lite", "Veo 3.1 - Fast", "Veo 3.1 - Quality", "Omni 1.1 Flash"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </Field>}
            </div>
            {engine === "edit" && (
              <div className="space-y-3 rounded-xl border border-line p-3">
                <p className="text-xs font-medium text-ink">Video gốc của Sếp <span className="font-normal text-muted">(cảnh quay, livestream, bài giảng, quay sản phẩm… — tải nhiều file được, tối đa 4 GB/file). Có lời nói: giữ nguyên lời và cắt câu hay. Không có lời nói: AI viết lời đọc theo yêu cầu</span></p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {form.video.materials.map((m: any, i: number) => <span key={m.path} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1">{m.name}<button onClick={() => setV({ materials: form.video.materials.filter((_: any, j: number) => j !== i) })}><Trash2 className="h-3 w-3 text-muted" /></button></span>)}
                  <label className={cx("flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1 text-muted hover:bg-soft", upPct !== null && "pointer-events-none opacity-60")}>{upPct !== null ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải {upPct}%</> : <><Film className="h-3.5 w-3.5" />Tải video gốc</>}<input type="file" accept="video/*,audio/*" multiple className="hidden" onChange={(e) => void uploadSources(e.target.files)} /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Phong cách dựng" hint="AI cắt cảnh, chuyển cảnh, zoom in/out, chữ động, phụ đề từng từ, hiệu ứng âm thanh và nhạc nền theo phong cách này">
                    <select className={inputCls} value={form.video.style ?? "dynamic"} onChange={(e) => setV({ style: e.target.value })}>{EDIT_STYLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </Field>
                  <Field label="Khung hình" hint="Video ngang được cắt giữa khung cho dọc/vuông">
                    <select className={inputCls} value={["9:16", "1:1", "16:9"].includes(form.video.aspect) ? form.video.aspect : "9:16"} onChange={(e) => setV({ aspect: e.target.value })}><option value="9:16">Dọc 9:16 (TikTok/Reels/Shorts)</option><option value="1:1">Vuông 1:1</option><option value="16:9">Ngang 16:9</option></select>
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={form.video.music !== "none"} onChange={(e) => setV({ music: e.target.checked ? "auto" : "none" })} />Thêm nhạc nền (tự hạ nhỏ khi có giọng nói)</label>
              </div>
            )}
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
            {manual ? <ManualScript contentId={form.sourceContentId} model={form.veoModel} onPick={pickManualScript}
              onScenes={(scenes, ok, p) => setForm((f: any) => ({ ...f, manualScenes: scenes, manualOk: ok, ...(p ? { manualCount: p.scenes.length, durationSec: p.durationSec } : {}) }))} /> : <Field label={engine === "news" ? "Link bài báo + ghi chú" : engine === "edit" ? "Yêu cầu edit" : "Thông tin sản phẩm / chủ đề / kịch bản"} hint={engine === "news" && form.brief && !/https?:\/\//.test(form.brief) ? "Cần có link bài báo (http…)" : undefined}><textarea rows={6} className={inputCls} value={form.brief} onChange={(e) => set({ brief: e.target.value })} placeholder={engine === "news" ? "https://vnexpress.net/... \nGhi chú (tuỳ chọn): giọng nữ, nhấn mạnh số liệu..." : engine === "edit" ? "Vd: Cắt 1 video 45 giây từ buổi livestream, lấy đoạn nói về 3 sai lầm khi dùng AI, mở đầu bằng câu gây tò mò nhất, bỏ đoạn đọc bình luận…" : "Giá, vị, điểm nổi bật, ưu đãi, link affiliate… hoặc chủ đề phim + thông điệp"} /></Field>}
            <Fold flat title="Tuỳ chọn thêm" summary={[form.voice && "giọng", form.hookTitle && "hook", form.cta && "CTA"].filter(Boolean).join(" · ") || "giọng đọc · tiêu đề hook · CTA (không bắt buộc)"} defaultOpen={false}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Giọng" hint={manual ? "AI dựa vào đây khi mô tả giọng cho Veo" : undefined}><input className={inputCls} value={form.voice} onChange={(e) => set({ voice: e.target.value })} placeholder="Nữ, miền Bắc, xưng chị" /></Field>
                <Field label="Tiêu đề hook"><input className={inputCls} value={form.hookTitle} onChange={(e) => set({ hookTitle: e.target.value })} /></Field>
                <Field label="CTA trên video"><input className={inputCls} value={form.cta} onChange={(e) => set({ cta: e.target.value })} placeholder="Bấm giỏ hàng ngay" /></Field>
              </div>
            </Fold>
            <ImageSlots slots={tool?.slots ?? []} images={form.images} onUpload={upload} onRemove={(path) => set({ images: form.images.filter((i: any) => i.path !== path) })}
              onRole={(path, role) => set({ images: form.images.map((i: any) => (i.path === path ? { ...i, role } : i)) })}
              note={manual ? "Ảnh chính diện, rõ mặt, đủ sáng, chỉ 1 người. AI dùng ảnh này làm tham chiếu khuôn mặt cho ảnh storyboard của mọi cảnh, rồi Veo dựng video từ chính ảnh storyboard đó." : engine === "flow" && form.tool === "review-do-an-vat" ? "Ô nào để trống thì AI tự tạo ảnh trên Flow. Ảnh Sếp tải lên được dùng đúng ô, giữ nguyên khuôn mặt nhân vật chính ở mọi cảnh." : form.tool === "review-nha-hang" ? "Bắt buộc ảnh THẬT mặt tiền và không gian (cảnh 1 ngoài quán, các cảnh sau trong quán) — không để AI vẽ quán không có thật. Ghi tên, địa chỉ, món/dịch vụ, giá, giờ mở cửa, ưu đãi trong phần thông tin; mỗi đoạn 8 giây." : form.tool === "review-gia-dung" ? "Bắt buộc ảnh thật của sản phẩm. Ghi đủ công dụng, thông số, giá/ưu đãi và tên thương hiệu/shop trong phần thông tin — Tool viết kịch bản chỉ từ đó. Không có ảnh KOC thì AI tự sinh người review; 5 cảnh × 8 giây." : form.tool === "koc-thoi-trang-nu" ? "Bắt buộc ảnh thật của sản phẩm (SP1) để giữ đúng màu, hoạ tiết. Thiếu ảnh KOC hoặc bối cảnh thì AI tự tạo; Tool dựng ảnh KOC mặc đồ trong bối cảnh rồi 5 góc selfie, 6 cảnh × 8 giây." : form.tool === "nhan-hieu" ? "Bắt buộc ảnh chân dung rõ mặt của chính người đứng tên nhân hiệu — AI giữ đúng gương mặt ở mọi cảnh. Giọng được khóa bằng một mẫu giọng (nam/nữ theo ô Giọng) để các cảnh nói cùng một giọng." : form.tool === "nguoi-que-so-sanh" ? "Ảnh người que quyết định nét vẽ của cả video (thiếu thì AI tự tạo người que trên Flow). Mỗi cảnh chỉ dùng 3 ảnh: người que + sản phẩm A + sản phẩm B." : form.tool === "review-thoi-trang" ? "Nên có ảnh thật của sản phẩm để AI giữ đúng màu, logo, đường may. Thiếu ảnh người mẫu thì AI tự tạo; Tool thử đồ AI rồi giữ nguyên mặt người mẫu ở mọi cảnh (mỗi cảnh 8 giây)." : engine === "flow" ? "Ảnh Sếp tải lên được dùng làm tham chiếu cho đúng vai trò; nhân vật chính giữ nguyên khuôn mặt ở mọi cảnh." : undefined}
              extras={engine === "flow" && !manual} />
            <PlatformPicker value={form.channels} onChange={(channels) => set({ channels })} />
            <div className="flex flex-col items-end gap-2">
              {whyNot.length > 0 && <ul className="w-full list-disc rounded-lg bg-amber-500/10 py-2 pl-7 pr-3 text-xs text-amber-800 dark:text-amber-200">{whyNot.map((w) => <li key={w}>{w}</li>)}</ul>}
              <Button variant="primary" icon={Play} disabled={whyNot.length > 0} onClick={() => setConfirm(true)}>Bắt đầu sản xuất</Button>
            </div>
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
              {engine === "edit" ? <li>AI xem {form.video.materials.length} video thô (ảnh tổng hợp phân cảnh) và lập kế hoạch dựng; hệ thống cắt cảnh, chuyển cảnh, zoom, chữ động, phụ đề từng từ, hiệu ứng âm thanh, nhạc nền, chuẩn âm -14 LUFS, rồi tự soát lỗi 1 vòng → Review → hộp Duyệt.</li>
                : engine === "news" ? <li>Claude CLI đọc bài, viết lời đọc (không bịa số liệu, ghi nguồn báo + ảnh), tạo giọng Việt, phụ đề karaoke, đồ hoạ Remotion, chuẩn âm thanh -14 LUFS → Review → hộp Duyệt → đăng bản nháp lên {form.channels.join(", ")} sau khi duyệt.</li>
                : engine === "moneyprinter" ? <li>Claude CLI viết lời đọc{form.video.scriptReady ? " (giữ nguyên lời Sếp)" : ""}, MoneyPrinterTurbo ghép cảnh + giọng Việt + phụ đề → Review → hộp Duyệt → đăng bản nháp lên {form.channels.join(", ")} sau khi duyệt.</li>
                : <li>Clip cử động vào thư viện video (dùng làm đoạn mở đầu / chèn vào video khác), không tự đăng.</li>}
            </ul>
          ) : (
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {manual
              ? <>
                <li>Claude xem ảnh khuôn mặt + kịch bản đã duyệt, chọn concept, làm {form.manualCount ? `${form.manualCount} cảnh · ${form.durationSec} giây` : "các cảnh"} theo phân cảnh {form.manualScenes ? "Sếp đã chỉnh" : "hệ thống chia"} (lời thoại giữ nguyên văn), viết prompt ảnh storyboard và prompt video cho từng cảnh.</li>
                <li>Agent dùng <b>{useChrome ? "Claude in Chrome" : "Chrome Flow"}</b> (tài khoản {settings.data?.chromeProfileEmail ?? settings.data?.chromeProfileName ?? "đã chọn"}{useChrome ? ", tab riêng" : ", cửa sổ riêng chạy ngầm"}): mở dự án Flow mới, tải ảnh khuôn mặt, tạo ảnh storyboard từng cảnh, tạo video {form.veoModel} từ ảnh đó, tải clip về (khoảng {tool?.minutes ?? 60} phút).{useChrome ? " Hồ sơ Chrome đó phải đang mở." : ""}</li>
                <li>Hệ thống tự ghép clip, chèn phụ đề, tiêu đề hook, CTA, rồi gửi vào hộp Duyệt.</li>
              </>
              : tool?.generator
              ? <li>Hệ thống <b>tự chạy ngầm, không cần Sếp bấm gì</b>: AI mở Google Flow trong Chrome Flow (tài khoản {settings.data?.chromeProfileEmail ?? settings.data?.chromeProfileName ?? "đã chọn"}), dùng <b>trình tạo video thường</b> (Thành phần · 9:16 · Omni 1.1 Flash · 720p) với ảnh nhân vật của Sếp, tạo từng cảnh 8–10 giây, lưu theo đúng thứ tự rồi ghép + chèn phụ đề (khoảng {tool?.minutes ?? 35} phút). Chỉ có thông báo khi video đã xong.</li>
              : <li>Hệ thống <b>tự chạy ngầm, không cần Sếp bấm gì</b>: AI mở Tool <b>{tool?.label}</b> trong Chrome Flow (tài khoản {settings.data?.chromeProfileEmail ?? settings.data?.chromeProfileName ?? "đã chọn"}), chạy đủ các bước Cấu hình → Khung chủ → Kịch bản → Storyboard → Sản xuất, tải clip, ghép + chèn phụ đề (khoảng {tool?.minutes ?? 40} phút). Chỉ có thông báo khi video đã xong.</li>}
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

const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram" };

/**
 * Nền tảng đăng nháp sau khi duyệt — KHÔNG chọn sẵn, Sếp tự chọn. Mỗi nền tảng hiện kênh đang nối (Kênh đăng) và có tự lên
 * nháp được không; chưa nối thì video vẫn làm và duyệt được, chỉ chưa tự lên nháp.
 */
function PlatformPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: channels } = useApi<any[]>("channels");
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Nền tảng đăng <span className="text-xs font-normal text-muted">— chọn 1 hoặc nhiều; sau khi Sếp duyệt video, hệ thống đăng bản nháp lên các nền tảng này</span></p>
      <div className="grid gap-2 sm:grid-cols-3">
        {CHANNELS.map((p) => {
          const on = value.includes(p);
          const list = (channels ?? []).filter((c) => c.platform === p);
          const live = list.find((c) => c.publishLive);
          return (
            <button key={p} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
              className={cx("flex min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition", on ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:bg-soft")}>
              <input type="checkbox" readOnly checked={on} tabIndex={-1} className="mt-0.5 shrink-0" />
              <PlatformIcon p={p} size={18} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{PLATFORM_LABEL[p] ?? p}</span>
                <span className={cx("block truncate text-[11px]", live ? "text-emerald-600" : "text-muted")} title={list.map((c) => c.name).join(", ")}>
                  {!channels ? "…" : live ? `Tự lên nháp · ${live.name}` : list.length ? `${list[0].name} · chưa nối đăng tự động` : "Chưa có kênh (Kênh đăng)"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {value.length > 0 && channels && value.some((p) => !(channels ?? []).some((c) => c.platform === p && c.publishLive)) && (
        <p className="text-xs text-amber-700 dark:text-amber-300">Nền tảng chưa nối đăng tự động: video vẫn được làm và duyệt, nhưng chưa tự lên nháp — nối kênh ở trang <Link to="/channels" className="underline">Kênh đăng</Link>.</p>
      )}
    </div>
  );
}

/** Link Tool Flow dùng chung + ghi chú quyền truy cập + ô dán link bản sao của Sếp. */
function ToolLink({ tool, onSaved }: { tool: any; onSaved: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [url, setUrl] = useState("");
  const custom = tool.toolUrl && tool.defaultToolUrl && tool.toolUrl !== tool.defaultToolUrl;
  const save = async (v: string) => {
    try { await api.put("creative/settings", { toolUrls: { [tool.key]: v } }); toast(v ? "Đã lưu link bản sao" : "Đã dùng lại link Tool mặc định"); setEdit(false); setUrl(""); onSaved(); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2">Tool Flow: {tool.toolUrl
        ? <a href={tool.toolUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600">{tool.toolTitle ?? tool.label}<ExternalLink className="h-3 w-3" /></a>
        : <span>agent tự tìm "{tool.toolTitle ?? tool.label}" trong mục Tools của Flow</span>}
        {custom && <Badge tone="violet">bản sao của Sếp</Badge>}
        {tool.toolUrl && <button className="text-blue-600 underline-offset-2 hover:underline" onClick={() => setEdit((v) => !v)}>{edit ? "Đóng" : "Dùng link bản sao"}</button>}
        {custom && <button className="text-muted underline-offset-2 hover:underline" onClick={() => save("")}>Về link mặc định</button>}
      </p>
      {tool.toolUrl && <details><summary className="text-[11px]">Lưu ý quyền truy cập Tool</summary><p className="mt-1 text-[11px] leading-relaxed">Tool này nằm trong một project Google Flow dùng chung. Nếu tài khoản Google của Sếp chưa được chia sẻ, video sẽ dừng với lỗi "Tài khoản Google chưa có quyền mở Tool này" — nhờ người chia sẻ Tool, hoặc mở Tool → tạo bản sao vào project của Sếp rồi dán link bản sao vào đây.</p></details>}
      {edit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input className={cx(inputCls, "h-8 min-w-0 flex-1 py-1 text-xs")} placeholder="https://flow.google.com/project/…/tool/…" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
          <Button size="sm" disabled={!url} onClick={() => save(url)}>Lưu</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Làm thủ công trên Flow: chọn kịch bản đã duyệt (từ Sản xuất nội dung) + phân cảnh — chưa gọi AI, chưa tốn tín dụng.
 * Hệ thống chia cảnh cân đối sẵn; Sếp sửa tự do (mỗi dòng 1 cảnh, xuống dòng = tách, xoá xuống dòng = gộp), máy chủ kiểm
 * tra lời vẫn nguyên văn + không quá trần chữ/cảnh của model.
 */
function ManualScript({ contentId, model, onPick, onScenes }: {
  contentId?: string; model: string; onPick: (id: string) => void;
  onScenes: (scenes: string[] | undefined, ok: boolean, preview?: any) => void;
}) {
  const list = useApi<any[]>("video-scripts", ["approval.", "task."]);
  const [text, setText] = useState<string | null>(null); // null = để hệ thống chia tự động
  const [m, setM] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setText(null); setM(null); }, [contentId]);
  useEffect(() => {
    if (!contentId) { setPreviewError(null); return; }
    let live = true;
    const scenes = text === null ? undefined : text.split("\n").map((s) => s.trim()).filter(Boolean);
    const t = window.setTimeout(() => {
      api.post(`content/${contentId}/flow-manual-preview`, { model, scenes })
        .then((r) => { if (!live) return; setM(r); setPreviewError(null); onScenes(scenes, true, r); })
        .catch((e) => { if (!live) return; setPreviewError(e.message); onScenes(scenes, false); });
    }, text === null ? 0 : 400);
    return () => { live = false; window.clearTimeout(t); };
  }, [contentId, model, text, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const scripts = (list.data ?? []).filter((p) => !p.error);
  const error = list.error ?? (contentId ? previewError : null);
  // 502/503: máy chủ đang khởi động lại (proxy không gọi được API) — tự thử lại, không bắt Sếp tải lại trang.
  const serverDown = !!error && /^Lỗi 50\d$/.test(error);
  const retry = () => { list.reload(); setTick((x) => x + 1); };
  useEffect(() => {
    if (!serverDown) return;
    const t = window.setTimeout(retry, 3000);
    return () => window.clearTimeout(t);
  }, [serverDown, error]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = text ?? (m?.scenes ?? []).map((s: any) => s.voice).join("\n");
  return (
    <div className="space-y-2">
      <Field label="Kịch bản đã duyệt" hint="Lời thoại lấy nguyên văn từ kịch bản đã duyệt ở Sản xuất nội dung, không sửa ở đây">
        <select className={inputCls} value={contentId ?? ""} onChange={(e) => onPick(e.target.value)}>
          <option value="">{list.data && !scripts.length ? "Chưa có kịch bản video nào đã duyệt" : "— chọn kịch bản —"}</option>
          {scripts.map((p) => <option key={p.contentId} value={p.contentId}>{p.title}{p.job && ["queued", "running"].includes(p.job.status) ? " (đang làm video)" : ""}</option>)}
        </select>
      </Field>
      {error && (
        <div className={cx("flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs", serverDown ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
          <span className="min-w-0 flex-1">{serverDown ? "Máy chủ đang khởi động lại — đang tự thử lại sau vài giây…" : error}</span>
          <Button size="sm" variant="ghost" onClick={retry}>Thử lại</Button>
        </div>
      )}
      {contentId && m && (
        <div className="space-y-2 rounded-xl border border-line p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-muted"><b className="text-ink">{m.scenes.length} cảnh · {m.durationSec} giây</b> · {m.words} chữ (~{m.speechSec} giây nói) · {m.rule}</p>
            {text !== null ? <Badge tone="violet">Sếp đã chỉnh</Badge> : <Badge>chia tự động</Badge>}
            {text !== null && <Button size="sm" variant="ghost" onClick={() => setText(null)}>Chia lại tự động</Button>}
          </div>
          <Field label="Phân cảnh (mỗi dòng = 1 cảnh)" hint="Enter để tách cảnh, xoá dấu xuống dòng để gộp. Chỉ đổi chỗ xuống dòng — lời giữ nguyên văn kịch bản đã duyệt.">
            <textarea rows={Math.min(14, Math.max(4, value.split("\n").length + 1))} className={cx(inputCls, "font-mono text-xs leading-relaxed")} value={value} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </Field>
          {!previewError && (
            <ol className="max-h-56 space-y-1 overflow-auto scroll-thin">
              {m.scenes.map((s: any) => (
                <li key={s.n} className="flex gap-2">
                  <span className="w-14 shrink-0 font-medium text-ink">Cảnh {s.n}</span>
                  <span className="min-w-0 flex-1 truncate" title={s.voice}>{s.voice}</span>
                  <span className={cx("shrink-0 tabular-nums", s.words < m.maxWords * 0.4 ? "text-amber-600" : s.words >= m.maxWords * 0.85 ? "text-emerald-600" : "text-muted")}>{s.words} chữ · {s.seconds}s</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted">Cảnh ít chữ (màu cam) vẫn làm được, nhân vật sẽ nói chậm/ngắt nghỉ trong cả clip. Concept, ảnh storyboard và prompt video do AI viết khi chạy; xem lại ở chi tiết lần sản xuất.</p>
        </div>
      )}
    </div>
  );
}

/** Kế hoạch AI đã lập cho luồng làm thủ công (concept + prompt từng cảnh). */
function ManualPlanView({ plan }: { plan: any }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-medium">Concept & phân cảnh AI đã lập ({plan.scenes.length} cảnh × 8 giây)</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p><b>{plan.concept.name}</b> · {plan.concept.why}</p>
        <p className="text-muted">Bối cảnh: {plan.concept.setting} · Trang phục: {plan.concept.wardrobe} · Ánh sáng: {plan.concept.lighting} · Giọng: {plan.concept.voice}</p>
        <ol className="max-h-72 space-y-2 overflow-auto scroll-thin">
          {plan.scenes.map((s: any) => (
            <li key={s.n} className="rounded-lg bg-soft p-2">
              <p><b>Cảnh {s.n}</b> · {s.shot} · {s.words} chữ</p>
              <p className="text-ink">"{s.voice}"</p>
              <details><summary className="cursor-pointer text-muted">Prompt ảnh + video</summary><p className="mt-1 font-mono text-[11px] text-muted">{s.imagePrompt}</p><p className="mt-1 font-mono text-[11px] text-muted">{s.videoPrompt}</p></details>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

/**
 * Google Flow chặn bước TẠO VIDEO tự động ("unusual activity"). Ảnh storyboard đã có trong dự án: Sếp tự bấm tạo video (người thật thì Flow
 * cho qua), hệ thống tự chờ đủ video → tải clip → ghép + phụ đề + hook + CTA → hộp Duyệt. Không tạo lại ảnh, không thử vượt kiểm tra của Google.
 */
function PlatformRiskGuide({ id, job, onChange }: { id: string; job: any; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"open" | "wait" | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const scenes: any[] = job.plan?.scenes ?? [];
  const run = async (k: "open" | "wait", fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast(ok, "info"); onChange(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } };
  const copy = async (n: number, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(n); setTimeout(() => setCopied(null), 1500); } catch { toast("Không sao chép được — bôi đen prompt rồi Ctrl+C", "err"); } };
  return (
    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <p className="text-sm font-semibold text-ink">{job.waiting ? "Đang chờ Sếp bấm tạo video trong dự án Flow" : job.riskRetryAt ? "Flow đang chặn tạo video tự động — hệ thống đang nghỉ rồi sẽ tự thử lại" : "Flow đang chặn bước tạo video tự động — hệ thống tự thử lại sau khi nghỉ, hoặc Sếp bấm tạo 1 bước"}</p>
      {job.riskRetryAt && <p className="rounded-lg bg-amber-500/10 p-2 text-ink">{job.riskRetryAt}. Mỗi lần thử, hệ thống làm TỪNG CẢNH MỘT và nghỉ giữa các cảnh để Flow không đánh dấu thêm; dự án + ảnh storyboard giữ nguyên, không tốn thêm tín dụng ảnh.</p>}
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>Bấm <b className="text-ink">Mở dự án Flow</b> (cửa sổ Chrome Flow đã đăng nhập sẵn hiện lên, {scenes.length} ảnh storyboard đã nằm trong dự án).</li>
        <li>Với từng cảnh: chọn ảnh storyboard của cảnh làm <b className="text-ink">khung đầu</b> (Frames to Video), dán prompt video của cảnh đó (nút <b className="text-ink">Sao chép</b> bên dưới — giữ nguyên câu thoại để hệ thống nhận đúng cảnh), bấm tạo. Tạo từng cảnh một, đừng bấm dồn dập.</li>
        <li>Khi đã bấm tạo cho các cảnh, bấm <b className="text-ink">Tôi đã bấm tạo — tự chờ & ghép</b>: hệ thống tự chờ đủ {scenes.length} video, tải clip, ghép + phụ đề + hook + CTA rồi gửi vào hộp Duyệt (chờ tối đa 2 giờ, bạn có thể đi làm việc khác).</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy === "wait"} disabled={busy !== null || job.waiting} title="Chạy lại bước tạo video tự động ngay (từng cảnh một). Nên đợi vài chục phút sau lần bị chặn." onClick={() => run("wait", () => api.post(`creative/jobs/${id}/manual-retry`), "Đã xếp việc tạo video tự động lại — chạy từng cảnh một")}>Thử tự động lại ngay</Button>
        <Button size="sm" variant="secondary" loading={busy === "open"} disabled={busy !== null} onClick={() => run("open", () => api.post(`creative/jobs/${id}/open-project`), "Đã mở dự án Flow trong Chrome Flow")}>Mở dự án Flow</Button>
        <a href={job.projectUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Mở bằng Chrome thường ↗</Button></a>
        <Button size="sm" variant="ghost" disabled={busy !== null || job.waiting} title="Dùng khi đã tạo đủ video (kể cả ở Chrome thường): tải ngay clip từ dự án rồi ghép" onClick={() => run("wait", () => api.post(`creative/jobs/${id}/manual-finish`), "Đang tải clip từ Flow và ghép — xong sẽ vào hộp Duyệt")}>Đã đủ video → tải & ghép ngay</Button>
        <Button size="sm" variant="secondary" icon={Play} loading={busy === "wait"} disabled={busy !== null || job.waiting} onClick={() => run("wait", () => api.post(`creative/jobs/${id}/manual-wait`), "Đang chờ video trong dự án Flow — đủ video là tự tải & ghép")}>{job.waiting ? "Đang tự chờ…" : "Tôi đã bấm tạo — tự chờ & ghép"}</Button>
      </div>
      {scenes.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium text-ink">Prompt video từng cảnh ({scenes.length}) — bấm Sao chép</summary>
          <ol className="mt-2 max-h-72 space-y-2 overflow-auto scroll-thin">
            {scenes.map((s) => (
              <li key={s.n} className="rounded-lg bg-soft p-2">
                <div className="flex items-start justify-between gap-2"><p className="min-w-0"><b>Cảnh {s.n}</b> · {s.seconds ?? 8}s · "{s.voice}"</p><Button size="sm" variant="secondary" onClick={() => copy(s.n, s.videoPrompt)}>{copied === s.n ? "Đã chép ✓" : "Sao chép"}</Button></div>
                <p className="mt-1 line-clamp-3 font-mono text-[11px] text-muted">{s.videoPrompt}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** Nhật ký quyền Chrome (chỉ có khi tác vụ chạy bằng Claude in Chrome). */
function ChromeLog({ id, running }: { id: string; running: boolean }) {
  const { data } = useApi<{ entries: any[] }>(`creative/jobs/${id}/chrome-log`, running ? ["creative."] : []);
  const entries = data?.entries ?? [];
  if (!entries.length) return null;
  const denied = entries.filter((e) => e.decision !== "allow").length;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-medium">Nhật ký quyền Chrome ({entries.length} lượt{denied ? `, ${denied} bị từ chối` : ""})</summary>
      <ol className="mt-2 max-h-60 space-y-1 overflow-auto font-mono text-[11px] scroll-thin">{[...entries].reverse().map((e, i) => <li key={i} className={e.decision === "allow" ? "text-muted" : "text-rose-600"}>{e.at ? new Date(e.at).toLocaleTimeString("vi-VN") : ""} · {e.tool} · {e.decision === "allow" ? "cho phép" : "TỪ CHỐI"}{e.host ? ` · ${e.host}` : ""}{e.decision !== "allow" && e.reason ? ` · ${e.reason}` : ""}</li>)}</ol>
    </details>
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
        {j.plan && j.projectUrl && (j.platformRisk || j.waiting) && (
          <PlatformRiskGuide id={id} job={j} onChange={reload} />
        )}
        {j.plan && !j.platformRisk && ["failed", "blocked"].includes(j.status) && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-xs">
            <span className="min-w-0 flex-1">Video đã tạo trên Flow vẫn còn trong dự án. Hệ thống tải lại clip từng cảnh rồi ghép — <b>không tạo lại video, không tốn tín dụng</b>.</span>
            <Button size="sm" variant="primary" icon={Play} onClick={async () => { try { await api.post(`creative/jobs/${id}/manual-finish`); toast("Đang tải clip từ Flow và ghép — xong sẽ vào hộp Duyệt", "info"); reload(); } catch (e: any) { toast(e.message, "err"); } }}>Tải clip từ Flow & ghép lại</Button>
          </div>
        )}
        {j.plan && <ManualPlanView plan={j.plan} />}
        <ChromeLog id={id} running={j.status === "running"} />
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
  const useChrome = current?.engine === "claude-in-chrome";
  const load = async () => { try { setData(await api.get("creative/chrome-profiles")); } catch (e: any) { toast(e.message, "err"); } };
  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (p: any) => `${p.channel}/${p.dir}`;
  const act = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { return await fn(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } };
  const choose = (p: any) => act(`c:${key(p)}`, async () => {
    await api.put("creative/settings", { chromeChannel: p.channel, chromeProfileDir: p.dir, chromeProfileName: p.name, chromeProfileEmail: p.email });
    if (useChrome) { toast(`Đã chọn profile "${p.name}" — bấm Ghép Chrome tại phần cơ chế trình duyệt`); onSaved(); return; }
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
        <p className="text-sm text-muted">{useChrome ? "Chọn profile Chrome có tiện ích Claude và đang đăng nhập tài khoản cần dùng. Sau đó mở profile và bấm Ghép Chrome." : <>Chọn profile <b className="text-ink">đang đăng nhập tài khoản Google có Flow</b> để hệ thống nối đăng nhập vào Chrome Flow.</>}</p>
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
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{p.name}{isCurrent(p) && <Badge tone="blue">Đang dùng</Badge>}{p.open && <Badge tone="green">Đang mở</Badge>}{p.claudeExtension && <Badge tone="blue">Có tiện ích Claude</Badge>}</p>
                      <p className="truncate text-xs text-muted">{p.email ?? "Chưa đăng nhập Google"} · {p.channelName} · {p.dir}</p>
                    </div>
                    {p.email ? <Badge tone="green">Đã đăng nhập Google</Badge> : <Badge tone="amber">Chưa đăng nhập Google</Badge>}
                  </div>
                  {chk && <p className={cx("mt-2 text-xs", chk.found ? "text-emerald-600" : "text-rose-600")}>{chk.text}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant={isCurrent(p) ? "secondary" : "primary"} loading={busy === `c:${k}`} disabled={useChrome && !p.claudeExtension} onClick={() => choose(p)}>{isCurrent(p) ? "Đã chọn" : "Chọn profile này"}</Button>
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
        <p className="rounded-xl bg-soft p-3 text-xs text-muted">{useChrome ? "Cho phép tiện ích Claude truy cập các trang cần dùng: flow.google.com, labs.google, accounts.google.com, facebook.com, instagram.com, tiktok.com. AI dừng khi cần mật khẩu hoặc mã xác minh." : "Nếu Google không nhận bản sao đăng nhập, đăng nhập một lần trong cửa sổ Chrome Flow."}</p>
      </div>
    </Modal>
  );
}

/** Dùng chung cho Video và Kênh đăng; lựa chọn áp dụng cho các tác vụ mới. */
export function BrowserEngineControl({ current, onSaved, flat }: { current: any; onSaved: () => void; flat?: boolean }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<any>(null);
  const useChrome = current?.engine === "claude-in-chrome";
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const setEngine = (engine: string) => act(async () => {
    await api.put("creative/settings", { engine, chromeAutoApprove: engine === "claude-in-chrome" });
    setConfirm(false); setScan(null); onSaved(); toast("Đã đổi cơ chế Chrome — kiểm tra lại đăng nhập ở Kênh đăng trước khi đăng bài");
  });
  return <Fold flat={flat} title="Cơ chế trình duyệt" summary={useChrome ? "Claude in Chrome — AI dùng Chrome thật của Sếp" : "Chrome Flow — cửa sổ Chrome riêng cho AI"} defaultOpen={false} bodyClass="space-y-3 px-4 pb-4 pt-1 text-sm">
    <div className="flex flex-wrap items-center gap-2"><Badge tone="blue">{useChrome ? "Claude in Chrome" : "Chrome Flow"}</Badge>
      <Button size="sm" disabled={busy} onClick={() => useChrome ? setEngine("chrome-flow") : setConfirm(true)}>{useChrome ? "Dùng Chrome Flow" : "Dùng Claude in Chrome"}</Button>
      {useChrome && <><Button size="sm" loading={busy} disabled={!current?.chromeProfileDir} onClick={() => act(async () => { const r = await api.post<any>("creative/browsers/pair"); toast(`Đã ghép ${r.label ?? "Chrome đã chọn"}`); onSaved(); })}>Ghép Chrome đã chọn</Button>
        <Button size="sm" disabled={busy} onClick={() => act(async () => { const r = await api.post<any>("creative/browsers"); setScan(r); if (r.error) toast(r.error, "err"); })}>Kiểm tra kết nối</Button></>}
    </div>
    <p className="text-xs text-muted">{useChrome ? "Giữ profile Chrome đã chọn đang mở và tiện ích Claude đang kết nối. Khi ghép, bấm Connect trong tiện ích nếu được yêu cầu. Tác vụ chỉ chạy trên Chrome của máy này." : "AI dùng cửa sổ Chrome Flow riêng. Bạn có thể chọn tiện ích Claude để dùng phiên đăng nhập ngay trong profile Chrome."}</p>
    {scan && <div className="space-y-1 text-xs">{scan.error && <p className="text-rose-600">{scan.error}</p>}{scan.accountHint && <p className="rounded-lg bg-amber-500/10 p-2 text-amber-700">{scan.accountHint}</p>}{scan.multipleHint && <p className="text-amber-700">{scan.multipleHint}</p>}{(scan.browsers ?? []).map((b: any) => <p key={b.deviceId}>{b.name ?? b.deviceId} · {b.otherMachine || b.unmatched ? "chưa khớp profile máy này" : "máy này"}{b.inUse ? " · đang kết nối" : ""}</p>)}</div>}
    <Modal open={confirm} onClose={() => setConfirm(false)} title="Dùng Claude in Chrome" footer={<><Button onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" loading={busy} onClick={() => setEngine("claude-in-chrome")}>Cho phép và bật</Button></>}>
      <div className="space-y-2 text-sm">
        <p><b>Agent sẽ điều khiển Chrome thật của Sếp</b> (đang đăng nhập Google/Facebook) và <b>không hỏi từng bước</b>. Hệ thống tự cho phép đúng các việc sau, mọi quyết định được ghi vào nhật ký (approver.jsonl):</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Chỉ mở trang https của Flow (flow.google.com, labs.google), đăng nhập Google, Facebook, Instagram, TikTok — trang khác bị từ chối.</li>
          <li>Chỉ tải lên tệp nằm trong thư mục của tác vụ, data/uploads, data/creative — không bao giờ .env, cơ sở dữ liệu, thư mục cá nhân hay hồ sơ Chrome.</li>
          <li>Công cụ ngoài danh sách (kể cả công cụ mới của tiện ích) bị từ chối; có công tắc khẩn cấp (tệp data/chrome-autoapprove.off hoặc ALLOW_CHROME_AUTOAPPROVE=0).</li>
          <li>Nghiên cứu (Trinh sát) vẫn chạy trên Chrome Flow riêng, không dùng Chrome thật của Sếp.</li>
        </ul>
        <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700"><b>Khuyến nghị:</b> trong cài đặt tiện ích Claude, chỉ cho phép quyền truy cập các trang cần dùng (flow.google.com, labs.google, accounts.google.com, facebook.com, instagram.com, tiktok.com). KHÔNG chọn “On all sites / Trên tất cả các trang web”. Tiện ích phải đăng nhập đúng tài khoản Claude mà Claude Code trên máy này đang dùng. Đừng khóa màn hình hoặc thu nhỏ Chrome khi tác vụ đang chạy.</p>
      </div>
    </Modal>
  </Fold>;
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
    <Card title="Công cụ video AI trên máy" collapsible="video.aitools" defaultOpen={false} summary="MoneyPrinterTurbo · LivePortrait · giọng đọc thử · tách phụ đề">
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
        <div className={cx("grid grid-cols-2 gap-3", slots.length === 1 ? "max-w-[15rem] grid-cols-1" : slots.length === 2 ? "sm:grid-cols-2" : slots.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 wide:grid-cols-4")}>
          {slots.map((sl) => {
            const img = images.find((i) => i.role === sl.role);
            return (
              <div key={sl.role}
                onDragOver={(e) => { e.preventDefault(); setOver(sl.role); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); onUpload(e.dataTransfer.files, sl.role); }}
                className={cx("group relative flex flex-col overflow-hidden rounded-xl border-2 border-dashed text-center transition", "h-56", over === sl.role ? "border-blue-500 bg-blue-500/5" : img ? "border-transparent" : "border-line bg-soft/40 hover:border-blue-400 hover:bg-blue-500/5")}>
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
                  <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-2 px-3 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/10 text-blue-600"><ImagePlus className="h-5 w-5" /></span>
                    <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">{sl.label}</span>
                    {sl.required ? <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600">bắt buộc</span> : <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-medium text-muted">tuỳ chọn</span>}
                    <span className="line-clamp-3 text-[11px] leading-snug text-muted">{sl.hint}</span>
                    <span className="mt-auto inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/5 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">Bấm hoặc kéo ảnh vào</span>
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
type Footage = { files: { path: string; name: string }[]; style: string; music: boolean };
const NO_FOOTAGE: Footage = { files: [], style: "dynamic", music: true };

/** Kịch bản "minh hoạ" không làm được bằng Flow: Sếp tải video thô lên, AI dựng thành video hoàn chỉnh (thay cho kho Pexels/Pixabay). */
function FootageBox({ value, onChange, needed }: { value: Footage; onChange: (f: Footage) => void; needed: boolean }) {
  const toast = useToast();
  const [pct, setPct] = useState<number | null>(null);
  const add = async (files: FileList | null) => {
    const added: Footage["files"] = [];
    for (const f of Array.from(files ?? [])) {
      if (!VIDEO_FILE_RE.test(f.name)) { toast(`${f.name}: chỉ nhận video (mp4, mov, webm, mkv)`, "err"); continue; }
      try { const r = await putVideoStream(f, setPct); added.push({ path: r.path, name: `${f.name} · ${(f.size / 1048576).toFixed(0)} MB` }); } catch (e: any) { toast(`${f.name}: ${e.message}`, "err"); }
    }
    if (added.length) onChange({ ...value, files: [...value.files, ...added] });
  };
  return (
    <Fold flat className="mt-2" icon={Film} tone={value.files.length ? "green" : needed ? "amber" : "gray"} defaultOpen={needed && !value.files.length}
      title="Dựng từ video thô của Sếp" summary={value.files.length ? `${value.files.length} video đã tải · AI sẽ dựng (thay cho kho Pexels/Pixabay)` : "tuỳ chọn · thay cho kho Pexels/Pixabay"} bodyClass="space-y-3 px-4 pb-3 pt-0">
      <p className="text-xs text-muted">Tải video thô (cảnh quay công ty, màn hình làm việc, sản phẩm, b-roll…). AI xem và chọn đoạn đẹp khớp từng cảnh của kịch bản, rồi dựng: <b className="text-ink">cắt cảnh, chuyển cảnh, zoom in/out, chữ động, phụ đề từng từ, hiệu ứng âm thanh, nhạc nền</b>. Lời đọc giữ đúng kịch bản đã duyệt.</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {value.files.map((m, i) => <span key={m.path} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1">{m.name}<button type="button" aria-label="Bỏ video" onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3 text-muted" /></button></span>)}
        <label className={cx("flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1 text-muted hover:bg-soft", pct !== null && "pointer-events-none opacity-60")}>
          {pct !== null ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tải {pct}%</> : <><Film className="h-3.5 w-3.5" />Tải video thô</>}
          <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <select className={cx(inputCls, "h-9 py-1 text-xs")} aria-label="Phong cách dựng" value={value.style} onChange={(e) => onChange({ ...value, style: e.target.value })}>{EDIT_STYLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={value.music} onChange={(e) => onChange({ ...value, music: e.target.checked })} />Nhạc nền</label>
      </div>
    </Fold>
  );
}

function ScriptsToVideo() {
  const list = useApi<any[]>("video-scripts", ["creative.", "approval.", "task."]);
  const [ask, setAsk] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const [footage, setFootage] = useState<Record<string, Footage>>({});
  const foot = (id: string) => footage[id] ?? NO_FOOTAGE;
  const plans = (list.data ?? []).filter((p) => !p.error && !(p.job && p.job.status === "done"));
  if (!list.data || !plans.length) return null;
  // Thiếu gì trừ khoản "video thô / khóa Pexels" khi Sếp đã tải video thô (khi đó video dựng từ chính video đó)
  const blockers = (p: any): string[] => (p.missing ?? []).filter((m: string) => !(foot(p.contentId).files.length && /Pexels|Pixabay|video thô/i.test(m)));
  const run = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const f = foot(ask.contentId);
      const r = await api.post(`content/${ask.contentId}/make-video`, f.files.length && ask.tool === "auto-video" ? { materials: f.files.map((x) => x.path), style: f.style, music: f.music ? "auto" : "none" } : {});
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
                {blockers(p).length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">{blockers(p).map((m: string) => <li key={m}>{m}</li>)}</ul>}
                {p.tool === "auto-video" && <FootageBox value={foot(p.contentId)} onChange={(f) => setFootage((x) => ({ ...x, [p.contentId]: f }))} needed={(p.missing ?? []).some((m: string) => /Pexels|Pixabay|video thô/i.test(m))} />}
                {running && <p className="mt-1 text-xs"><Badge tone="blue">{STATUS[p.job.status]?.[0] ?? p.job.status}</Badge> {p.job.step}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setParams({ from: p.contentId })}>Mở để chỉnh</Button>
                <Button size="sm" variant="soft" icon={Layers} disabled={Boolean(running)} onClick={() => setParams({ from: p.contentId, manual: "1" })} title="AI tự nghĩ concept, tạo ảnh storyboard + video Veo 3 từng cảnh trên Flow bằng Claude in Chrome (cần ảnh khuôn mặt)">Làm thủ công trên Flow</Button>
                <Button size="sm" variant="primary" icon={Play} disabled={Boolean(running) || blockers(p).length > 0} onClick={() => setAsk(p)}>{running ? "Đang tạo" : "Tạo video"}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={Boolean(ask)} onClose={() => setAsk(null)} title="Tạo video từ kịch bản?" footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Hủy</Button><Button variant="primary" loading={busy} onClick={run}>Bắt đầu</Button></>}>
        {ask && <div className="space-y-2 text-sm text-ink">
          <p><b>{ask.title}</b></p>
          {ask.tool === "auto-video" && foot(ask.contentId).files.length > 0
            ? <p>Dựng từ <b>{foot(ask.contentId).files.length} video thô của Sếp</b> · {ask.scenes} cảnh · khoảng {ask.durationSec} giây · AI chọn đoạn, cắt cảnh, chuyển cảnh, zoom, chữ động, phụ đề, hiệu ứng âm thanh · mất khoảng 10 đến 20 phút, không tốn tín dụng Flow.</p>
            : <p>Skill: <b>{ask.toolLabel}</b> · {ask.scenes} cảnh · khoảng {ask.durationSec} giây · mất khoảng {ask.minutes} phút.</p>}
          {ask.paidCredits && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Chạy trên Google Flow bằng Chrome Flow — <b>tốn tín dụng Flow</b> của tài khoản đã chọn. Chạy 1 video/lần, video sau xếp hàng.</p>}
          <p className="text-xs text-muted">Xong sẽ có thông báo; video vào "Duyệt & Phê duyệt" để Sếp xem trước khi đăng.</p>
        </div>}
      </Modal>
    </Card>
  );
}
