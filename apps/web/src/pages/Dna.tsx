import { useState, type ReactNode } from "react";
import { AlertTriangle, Ban, Building2, CheckCircle2, Circle, Download, FileUp, Gem, History, Megaphone, Mic, MousePointerClick, Package, Pencil, Plus, Sparkles, Target, Trash2, Upload, Users } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo, vnd, vndFull } from "../lib/format";
import { Badge, Button, Card, Empty, Field, IconTile, Loading, Modal, PageHeader, Progress, Ring, inputCls, useToast } from "../components/ui";

const SECTION_LABEL: Record<string, string> = {
  company: "Thông tin công ty", positioning: "Định vị", audience: "Khách hàng mục tiêu", products: "Sản phẩm/Dịch vụ", offers: "Ưu đãi",
  voice: "Giọng điệu thương hiệu", differentiators: "Giá trị khác biệt", channels: "Kênh truyền thông", goals: "Mục tiêu kinh doanh", forbiddenClaims: "Tuyên bố bị cấm",
  spokesperson: "Người đại diện & xưng hô", cta: "Lời kêu gọi chính", pendingConfirmations: "Điều chờ xác nhận", bannedChars: "Ký tự cấm",
};
type EditKey = "brand" | "audience" | "differentiators" | "voice" | "products" | "forbiddenClaims" | "goals" | "offers" | "channels" | "spokesperson" | "cta" | "pendingConfirmations" | "bannedChars";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function Dna() {
  const { data: d, reload } = useApi<any>("dna");
  const { data: ov } = useApi<any>("overview", ["metrics."]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ key: EditKey; draft: any } | null>(null);
  const [saving, setSaving] = useState(false);
  // ?import=1 (vừa tạo doanh nghiệp mới) → mở luôn hộp Nạp DNA.
  const [intake, setIntake] = useState(() => new URLSearchParams(window.location.search).get("import") === "1");
  if (!d) return <Loading />;
  const dna = d.data ?? {};
  const goals = dna.goals ?? {};
  const yearTarget = goals.yearTarget ?? ov?.goal?.yearTarget ?? 0;
  const runRate = ov?.goal?.runRate ?? goals.currentRunRate ?? 0;
  const goalPct = yearTarget ? Math.round((runRate / yearTarget) * 100) : 0;

  const open = (key: EditKey) => {
    const draft: Record<EditKey, any> = {
      brand: { ...(dna.company ?? {}), positioning: dna.positioning ?? "", mission: dna.mission ?? "" },
      audience: (dna.audience ?? []).map((a: any) => ({ name: a.name ?? "", pains: (a.pains ?? []).join("\n"), goals: (a.goals ?? []).join("\n") })),
      differentiators: (dna.differentiators ?? []).join("\n"),
      forbiddenClaims: (dna.forbiddenClaims ?? []).join("\n"),
      offers: (dna.offers ?? []).join("\n"),
      channels: (dna.channels ?? []).join("\n"),
      voice: { style: (dna.voice?.style ?? []).join(", "), do: (dna.voice?.do ?? []).join("\n"), dont: (dna.voice?.dont ?? []).join("\n"), sample: dna.voice?.sample ?? "" },
      products: (dna.products ?? []).map((p: any) => ({ ...p, aliases: (p.aliases ?? []).join(", ") })),
      spokesperson: { ...(dna.spokesperson ?? {}), name: dna.spokesperson?.name ?? dna.company?.ceo ?? "", selfPronoun: dna.voice?.selfPronoun ?? "em", customerPronoun: dna.voice?.customerPronoun ?? "anh/chị" },
      cta: { leadMagnet: dna.leadMagnet ?? "", text: dna.cta?.text ?? "", link: dna.cta?.link ?? "" },
      pendingConfirmations: (dna.pendingConfirmations ?? []).join("\n"),
      bannedChars: (dna.bannedChars ?? []).join("\n"),
      goals: { yearTarget: goals.yearTarget ?? 0, currentRunRate: goals.currentRunRate ?? 0, painPoint: goals.painPoint ?? "", competitors: (goals.competitors ?? []).join(", ") },
    };
    setEdit({ key, draft: draft[key] });
  };

  const save = async () => {
    if (!edit) return;
    const { key, draft } = edit;
    let data: any;
    if (key === "brand") { const { positioning, mission, ...company } = draft; data = { company, positioning, mission }; }
    else if (key === "audience") data = { audience: draft.filter((a: any) => a.name.trim()).map((a: any) => ({ name: a.name.trim(), pains: lines(a.pains), goals: lines(a.goals) })) };
    else if (key === "voice") data = { voice: { ...(dna.voice ?? {}), style: draft.style.split(",").map((s: string) => s.trim()).filter(Boolean), do: lines(draft.do), dont: lines(draft.dont), sample: draft.sample } };
    else if (key === "products") data = { products: draft.filter((p: any) => p.name.trim()).map((p: any) => ({ ...p, aliases: String(p.aliases ?? "").split(",").map((x: string) => x.trim()).filter(Boolean) })) };
    else if (key === "spokesperson") { const { selfPronoun, customerPronoun, ...sp } = draft; data = { spokesperson: sp, voice: { ...(dna.voice ?? {}), selfPronoun, customerPronoun } }; }
    else if (key === "cta") data = { leadMagnet: draft.leadMagnet, cta: { text: draft.text, link: draft.link } };
    else if (key === "goals") data = { goals: { ...goals, yearTarget: Number(draft.yearTarget) || 0, currentRunRate: Number(draft.currentRunRate) || 0, painPoint: draft.painPoint, competitors: draft.competitors.split(",").map((s: string) => s.trim()).filter(Boolean) } };
    else data = { [key]: lines(draft) };
    setSaving(true);
    try {
      const row = await api.put("dna", { data });
      toast(`Đã lưu DNA phiên bản ${row.version ?? "mới"}`);
      setEdit(null);
      reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };

  const editBtn = (key: EditKey) => <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(key)}>Chỉnh sửa</Button>;
  const setDraft = (draft: any) => setEdit((e) => (e ? { ...e, draft } : e));

  return (
    <div className="space-y-6">
      <PageHeader title="Mục tiêu & DNA" subtitle="Thiết lập hồ sơ doanh nghiệp để Agent AI hiểu rõ thương hiệu, khách hàng và định hướng phát triển. Mọi luồng (chat, chăm khách, nội dung, video) đọc DNA này — đổi DNA là hệ thống chạy theo doanh nghiệp mới."
        actions={<Button variant="primary" icon={Sparkles} onClick={() => setIntake(true)}>Nạp DNA</Button>} />

      {d.warnings?.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1 space-y-1">{d.warnings.map((w: string) => <p key={w}>{w}</p>)}</div>
          <Button size="sm" onClick={() => open("products")}>Cập nhật giá</Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card title="Mức độ hoàn thiện DNA">
          <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
            <Ring value={d.completeness ?? 0} color={(d.completeness ?? 0) >= 90 ? "#10b981" : "#f59e0b"}>
              <div><p className="text-3xl font-bold text-ink">{d.completeness ?? 0}%</p><p className="text-xs text-muted">hoàn thiện</p></div>
            </Ring>
            <ul className="grid w-full gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-1">
              {d.sections?.map((s: any) => (
                <li key={s.key} className="flex items-center gap-2">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-muted" />}
                  <span className={s.done ? "text-ink" : "text-muted"}>{SECTION_LABEL[s.key] ?? s.key}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Target className="h-4 w-4 text-blue-600" />Mục tiêu kinh doanh 12 tháng</span>} action={editBtn("goals")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Mục tiêu năm" value={yearTarget ? vnd(yearTarget) : "Chưa đặt"} />
            <Metric label="Run-rate hiện tại" value={vnd(runRate)} />
            <Metric label="Điểm xuất phát" value={goals.currentRunRate ? vnd(goals.currentRunRate) : "Chưa đặt"} />
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex justify-between text-sm"><span className="font-medium text-ink">Tiến độ so với mục tiêu</span><span className="text-muted">{goalPct}%</span></div>
            <Progress value={goalPct} tone={goalPct >= 100 ? "green" : "blue"} />
            {goals.currentRunRate > 0 && <p className="text-xs text-muted">Cần tăng {Math.round((yearTarget / goals.currentRunRate - 1) * 100)}% so với mức {vnd(goals.currentRunRate)}/năm · còn thiếu {vnd(Math.max(0, yearTarget - runRate))} run-rate</p>}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Nỗi đau lớn nhất</p><p className="mt-1 font-medium text-ink">{goals.painPoint || "—"}</p></div>
            <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Đối thủ chính</p><div className="mt-1 flex flex-wrap gap-1">{(goals.competitors ?? []).map((c: string) => <Badge key={c} tone="red">{c}</Badge>)}</div></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard icon={Building2} tone="blue" title="Thông tin thương hiệu" action={editBtn("brand")}>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Tên</dt><dd className="font-medium text-ink">{dna.company?.name}</dd>
            <dt className="text-muted">Website</dt><dd className="text-ink">{dna.company?.website}</dd>
            <dt className="text-muted">Ngành</dt><dd className="text-ink">{dna.company?.industry}</dd>
            <dt className="text-muted">CEO</dt><dd className="text-ink">{dna.company?.ceo}</dd>
            <dt className="text-muted">Quy mô</dt><dd className="text-ink">{dna.company?.scale}</dd>
          </dl>
          <div className="mt-4 space-y-2 text-sm"><p className="text-xs font-medium uppercase text-muted">Định vị</p><p className="text-ink">{dna.positioning}</p>
            {dna.mission && <><p className="pt-1 text-xs font-medium uppercase text-muted">Sứ mệnh</p><p className="text-ink">{dna.mission}</p></>}</div>
        </SectionCard>

        <SectionCard icon={Users} tone="violet" title="Khách hàng mục tiêu" action={editBtn("audience")}>
          {(dna.audience ?? []).length === 0 ? <Empty>Chưa có chân dung khách hàng.</Empty> : (
            <div className="space-y-3">{dna.audience.map((a: any) => (
              <div key={a.name} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-medium text-ink">{a.name}</p>
                <p className="mt-1 text-xs text-muted"><span className="font-medium text-rose-500">Nỗi đau:</span> {(a.pains ?? []).join(" · ")}</p>
                <p className="mt-0.5 text-xs text-muted"><span className="font-medium text-emerald-600">Mong muốn:</span> {(a.goals ?? []).join(" · ")}</p>
              </div>))}</div>
          )}
        </SectionCard>

        <SectionCard icon={Gem} tone="green" title="Giá trị khác biệt" action={editBtn("differentiators")}>
          <List items={dna.differentiators} />
          {(dna.offers ?? []).length > 0 && <div className="mt-4 border-t border-line pt-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium uppercase text-muted">Ưu đãi đang áp dụng</p>{editBtn("offers")}</div><List items={dna.offers} /></div>}
        </SectionCard>

        <SectionCard icon={Megaphone} tone="pink" title="Giọng điệu thương hiệu" action={editBtn("voice")}>
          <div className="flex flex-wrap gap-1.5">{(dna.voice?.style ?? []).map((s: string) => <Badge key={s} tone="violet">{s}</Badge>)}</div>
          {dna.voice?.sample && <blockquote className="mt-3 border-l-4 border-violet-400 bg-soft px-3 py-2 text-sm italic text-ink">“{dna.voice.sample}”</blockquote>}
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="mb-1 text-xs font-medium text-emerald-600">Nên</p><List items={dna.voice?.do} /></div>
            <div><p className="mb-1 text-xs font-medium text-rose-500">Tránh</p><List items={dna.voice?.dont} /></div>
          </div>
          {(dna.channels ?? []).length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">Kênh: {dna.channels.map((c: string) => <Badge key={c}>{c}</Badge>)}<button className="ml-auto text-blue-600" onClick={() => open("channels")}>Sửa kênh</button></div>}
        </SectionCard>

        <SectionCard icon={Package} tone="amber" title="Sản phẩm/Dịch vụ chính" action={editBtn("products")}>
          <div className="divide-y divide-line">{(dna.products ?? []).map((p: any) => (
            <div key={p.key ?? p.name} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0"><p className="text-sm font-medium text-ink">{p.name}</p><p className="text-xs text-muted">{p.summary}{p.format ? ` · ${p.format}` : ""}</p></div>
              <div className="shrink-0 text-right"><p className="text-sm font-semibold text-ink">{p.price == null ? "Liên hệ" : p.price ? vndFull(p.price) : "Miễn phí"}</p>{(p.sample || p.verified === false) && <Badge tone="amber">⚠️ chờ xác nhận</Badge>}{p.link && <p className="text-[11px] text-muted">{p.link}</p>}</div>
            </div>))}</div>
        </SectionCard>

        <SectionCard icon={Ban} tone="red" title="Tuyên bố bị cấm" action={editBtn("forbiddenClaims")}>
          <p className="mb-3 text-xs text-muted">Review Agent sẽ chặn mọi nội dung chứa các cụm từ này trước khi đến bàn Sếp.</p>
          <div className="flex flex-wrap gap-1.5">{(dna.forbiddenClaims ?? []).map((c: string) => <Badge key={c} tone="red">{c}</Badge>)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">Ký tự cấm: {(dna.bannedChars ?? []).length ? dna.bannedChars.map((c: string) => <Badge key={c}>{c}</Badge>) : "—"}<button className="ml-auto text-blue-600" onClick={() => open("bannedChars")}>Sửa</button></div>
        </SectionCard>

        <SectionCard icon={Mic} tone="violet" title="Người đại diện & xưng hô" action={editBtn("spokesperson")}>
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Gương mặt video</dt><dd className="font-medium text-ink">{dna.spokesperson?.name || dna.company?.ceo || "—"}</dd>
            <dt className="text-muted">Giọng đọc</dt><dd className="text-ink">{dna.spokesperson?.voiceDesc || [dna.spokesperson?.gender && `giọng ${dna.spokesperson.gender}`, dna.spokesperson?.region && `miền ${dna.spokesperson.region}`, dna.spokesperson?.age && `${dna.spokesperson.age} tuổi`].filter(Boolean).join(", ") || "—"}</dd>
            <dt className="text-muted">Xưng hô với khách</dt><dd className="text-ink">tự xưng “{dna.voice?.selfPronoun || "em"}”, gọi khách “{dna.voice?.customerPronoun || "anh/chị"}”</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">Video nhân hiệu dùng người này làm gương mặt + giọng; chat, follow-up, chăm khách dùng cách xưng hô này.</p>
        </SectionCard>

        <SectionCard icon={MousePointerClick} tone="green" title="Lời kêu gọi chính" action={editBtn("cta")}>
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Ưu đãi mồi</dt><dd className="text-ink">{dna.leadMagnet || "—"}</dd>
            <dt className="text-muted">CTA</dt><dd className="text-ink">{dna.cta?.text || "—"}</dd>
            <dt className="text-muted">Link chính</dt><dd className="break-all text-ink">{dna.cta?.link || "—"}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">Follow-up chat mời khách bằng ưu đãi mồi; chăm khách từ bình luận gửi link chính khi sản phẩm chưa có link riêng.</p>
        </SectionCard>

        <SectionCard icon={AlertTriangle} tone="amber" title="Điều chờ xác nhận" action={editBtn("pendingConfirmations")}>
          <p className="mb-2 text-xs text-muted">Agent không khẳng định những điều này (số liệu, giá, USP…) cho tới khi Sếp xác nhận và xoá khỏi danh sách.</p>
          <List items={dna.pendingConfirmations} />
        </SectionCard>
      </div>

      <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-muted" />Lịch sử phiên bản DNA</span>}>
        <div className="divide-y divide-line">{(d.versions ?? []).map((v: any) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="font-medium text-ink">Phiên bản {v.version}</span>
            <span className="text-muted">bởi {v.created_by} · {timeAgo(v.created_at)}</span>
            <Badge tone={v.status === "active" ? "green" : "gray"}>{v.status === "active" ? "Đang dùng" : "Lưu trữ"}</Badge>
          </div>))}</div>
      </Card>

      <DnaIntake open={intake} onClose={() => setIntake(false)} onSaved={() => { setIntake(false); reload(); }} />

      <Modal open={!!edit} onClose={() => setEdit(null)} wide={edit?.key === "products" || edit?.key === "audience"}
        title={edit ? `Chỉnh sửa: ${edit.key === "brand" ? "Thông tin thương hiệu" : SECTION_LABEL[edit.key]}` : ""}
        footer={<><Button onClick={() => setEdit(null)}>Hủy</Button><Button variant="primary" loading={saving} onClick={save}>Lưu phiên bản mới</Button></>}>
        {edit && <Editor k={edit.key} draft={edit.draft} set={setDraft} />}
      </Modal>
    </div>
  );
}

function Editor({ k, draft, set }: { k: EditKey; draft: any; set: (d: any) => void }) {
  if (k === "brand") return (
    <div className="grid gap-3 sm:grid-cols-2">
      {([["name", "Tên thương hiệu"], ["website", "Website"], ["industry", "Ngành"], ["ceo", "CEO"], ["scale", "Quy mô"]] as const).map(([f, l]) => (
        <Field key={f} label={l}><input className={inputCls} value={draft[f] ?? ""} onChange={(e) => set({ ...draft, [f]: e.target.value })} /></Field>))}
      <div className="sm:col-span-2"><Field label="Định vị"><textarea rows={3} className={inputCls} value={draft.positioning} onChange={(e) => set({ ...draft, positioning: e.target.value })} /></Field></div>
      <div className="sm:col-span-2"><Field label="Sứ mệnh"><textarea rows={2} className={inputCls} value={draft.mission} onChange={(e) => set({ ...draft, mission: e.target.value })} /></Field></div>
    </div>
  );
  if (k === "voice") return (
    <div className="space-y-3">
      <Field label="Phong cách" hint="Phân cách bằng dấu phẩy"><input className={inputCls} value={draft.style} onChange={(e) => set({ ...draft, style: e.target.value })} /></Field>
      <Field label="Nên làm" hint="Mỗi dòng một ý"><textarea rows={3} className={inputCls} value={draft.do} onChange={(e) => set({ ...draft, do: e.target.value })} /></Field>
      <Field label="Tránh" hint="Mỗi dòng một ý"><textarea rows={3} className={inputCls} value={draft.dont} onChange={(e) => set({ ...draft, dont: e.target.value })} /></Field>
      <Field label="Câu mẫu"><textarea rows={2} className={inputCls} value={draft.sample} onChange={(e) => set({ ...draft, sample: e.target.value })} /></Field>
    </div>
  );
  if (k === "spokesperson") return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Người đại diện (gương mặt video)" hint="Trống = dùng CEO"><input className={inputCls} value={draft.name ?? ""} onChange={(e) => set({ ...draft, name: e.target.value })} /></Field>
      <Field label="Tuổi"><input className={inputCls} value={draft.age ?? ""} onChange={(e) => set({ ...draft, age: e.target.value })} /></Field>
      <Field label="Giới tính giọng"><select className={inputCls} value={draft.gender ?? ""} onChange={(e) => set({ ...draft, gender: e.target.value })}><option value="">—</option><option value="nam">Nam</option><option value="nữ">Nữ</option></select></Field>
      <Field label="Miền"><select className={inputCls} value={draft.region ?? ""} onChange={(e) => set({ ...draft, region: e.target.value })}><option value="">—</option><option value="Bắc">Bắc</option><option value="Trung">Trung</option><option value="Nam">Nam</option></select></Field>
      <div className="sm:col-span-2"><Field label="Mô tả giọng (tuỳ chọn)" hint="Vd: giọng nam miền Bắc, 40 tuổi, trầm, chắc"><input className={inputCls} value={draft.voiceDesc ?? ""} onChange={(e) => set({ ...draft, voiceDesc: e.target.value })} /></Field></div>
      <Field label="Bot/nhân viên tự xưng"><input className={inputCls} value={draft.selfPronoun} onChange={(e) => set({ ...draft, selfPronoun: e.target.value })} placeholder="em / mình / shop" /></Field>
      <Field label="Gọi khách là"><input className={inputCls} value={draft.customerPronoun} onChange={(e) => set({ ...draft, customerPronoun: e.target.value })} placeholder="anh/chị / bạn / quý khách" /></Field>
    </div>
  );
  if (k === "cta") return (
    <div className="space-y-3">
      <Field label="Ưu đãi mồi" hint="Vd: Buổi học thử miễn phí / Voucher 10% đơn đầu / Tư vấn 1-1 miễn phí"><input className={inputCls} value={draft.leadMagnet} onChange={(e) => set({ ...draft, leadMagnet: e.target.value })} /></Field>
      <Field label="Câu kêu gọi chính"><input className={inputCls} value={draft.text} onChange={(e) => set({ ...draft, text: e.target.value })} /></Field>
      <Field label="Link chính"><input className={inputCls} value={draft.link} onChange={(e) => set({ ...draft, link: e.target.value })} placeholder="https://…" /></Field>
    </div>
  );
  if (k === "goals") return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Mục tiêu năm (VND)" hint={vnd(Number(draft.yearTarget))}><input type="number" className={inputCls} value={draft.yearTarget} onChange={(e) => set({ ...draft, yearTarget: e.target.value })} /></Field>
      <Field label="Run-rate xuất phát (VND)" hint={vnd(Number(draft.currentRunRate))}><input type="number" className={inputCls} value={draft.currentRunRate} onChange={(e) => set({ ...draft, currentRunRate: e.target.value })} /></Field>
      <Field label="Nỗi đau lớn nhất"><input className={inputCls} value={draft.painPoint} onChange={(e) => set({ ...draft, painPoint: e.target.value })} /></Field>
      <Field label="Đối thủ" hint="Phân cách bằng dấu phẩy"><input className={inputCls} value={draft.competitors} onChange={(e) => set({ ...draft, competitors: e.target.value })} /></Field>
    </div>
  );
  if (k === "audience") return (
    <div className="space-y-3">
      {draft.map((a: any, i: number) => {
        const upd = (f: string, v: string) => set(draft.map((x: any, j: number) => (j === i ? { ...x, [f]: v } : x)));
        return (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex gap-2"><input className={inputCls} placeholder="Tên nhóm khách hàng" value={a.name} onChange={(e) => upd("name", e.target.value)} /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => set(draft.filter((_: any, j: number) => j !== i))} /></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <textarea rows={3} className={inputCls} placeholder="Nỗi đau (mỗi dòng một ý)" value={a.pains} onChange={(e) => upd("pains", e.target.value)} />
              <textarea rows={3} className={inputCls} placeholder="Mong muốn (mỗi dòng một ý)" value={a.goals} onChange={(e) => upd("goals", e.target.value)} />
            </div>
          </div>);
      })}
      <Button size="sm" icon={Plus} onClick={() => set([...draft, { name: "", pains: "", goals: "" }])}>Thêm nhóm khách hàng</Button>
    </div>
  );
  if (k === "products") return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Sửa giá sẽ bỏ nhãn “Giá mẫu” — agent sẽ báo giá theo con số này.</p>
      {draft.map((p: any, i: number) => {
        const upd = (patch: any) => set(draft.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={p.key ?? i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_160px_auto]">
            <input className={inputCls} placeholder="Tên sản phẩm" value={p.name} onChange={(e) => upd({ name: e.target.value })} />
            <input type="number" className={inputCls} placeholder="Giá (để trống = liên hệ)" value={p.price ?? ""} onChange={(e) => upd({ price: e.target.value === "" ? null : Number(e.target.value), sample: false, verified: true })} />
            <div className="flex items-center gap-2">{p.sample && <Badge tone="amber">Giá mẫu</Badge>}<Button size="sm" variant="ghost" icon={Trash2} onClick={() => set(draft.filter((_: any, j: number) => j !== i))} /></div>
            <textarea rows={2} className={cxs} placeholder="Mô tả ngắn" value={p.summary ?? ""} onChange={(e) => upd({ summary: e.target.value })} />
            <input className={inputCls} placeholder="Link sản phẩm" value={p.link ?? ""} onChange={(e) => upd({ link: e.target.value })} />
            <input className={inputCls} placeholder="Hình thức (Online/Offline/SaaS…)" value={p.format ?? ""} onChange={(e) => upd({ format: e.target.value })} />
            <input className={inputCls} placeholder="Tên gọi khác, cách nhau dấu phẩy" value={p.aliases ?? ""} onChange={(e) => upd({ aliases: e.target.value })} />
          </div>);
      })}
      <Button size="sm" icon={Plus} onClick={() => set([...draft, { key: `sp-${Date.now()}`, name: "", summary: "", price: 0, sample: false }])}>Thêm sản phẩm</Button>
    </div>
  );
  return <Field label={SECTION_LABEL[k]} hint="Mỗi dòng một mục"><textarea rows={8} className={inputCls} value={draft} onChange={(e) => set(e.target.value)} /></Field>;
}
const cxs = `${inputCls} sm:col-span-3`;

function SectionCard({ icon, tone, title, action, children }: { icon: any; tone: any; title: string; action: ReactNode; children: ReactNode }) {
  return <Card title={<span className="flex items-center gap-3"><IconTile icon={icon} tone={tone} size="sm" />{title}</span>} action={action}>{children}</Card>;
}
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><p className="text-xs text-muted">{label}</p><p className="mt-1 text-xl font-bold tracking-tight text-ink">{value}</p></div>;
}
function List({ items }: { items?: string[] }) {
  if (!items?.length) return <p className="text-sm text-muted">—</p>;
  return <ul className="space-y-1.5 text-sm">{items.map((x) => <li key={x} className="flex gap-2 text-ink"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />{x}</li>)}</ul>;
}

/** Nạp DNA cho doanh nghiệp bất kỳ: tài liệu → DNA Agent soạn nháp → xem trước → lưu; hoặc nhập/xuất JSON; hoặc làm từ trống. */
function DnaIntake({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [website, setWebsite] = useState("");
  const [readPages, setReadPages] = useState<{ url: string; title: string }[]>([]);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBlank, setConfirmBlank] = useState(false);
  const toData = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
  const pickDoc = async (f?: File) => {
    if (!f) return;
    setBusy("upload");
    try { const r = await api.post("/v1/uploads", { name: f.name, data: await toData(f) }); setFile({ path: r.path, name: f.name }); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const runAi = async () => {
    setBusy("ai");
    try {
      const r = await api.post("dna/draft", { text, path: file?.path, website: website.trim() || undefined });
      setDraft(r.draft); setReadPages(r.pages ?? []);
      toast(r.pages?.length ? `DNA Agent đã đọc ${r.pages.length} trang website và soạn xong bản nháp — Sếp xem lại rồi lưu` : "DNA Agent đã soạn xong bản nháp — Sếp xem lại rồi lưu");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const save = async (data: any, source: string) => {
    setBusy("save");
    try { const r = await api.post("dna/import", { data, replace: true, source }); toast(`Đã nạp DNA (phiên bản ${r.version}) — các luồng dùng DNA mới từ bây giờ`); setDraft(null); setText(""); setFile(null); onSaved(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try { const j = JSON.parse(await f.text()); setDraft(j.dna ?? j); toast("Đã đọc file — xem lại rồi bấm Lưu"); } catch { toast("File không phải JSON DNA hợp lệ", "err"); }
  };
  const exportJson = async () => {
    const j = await api.get("dna/export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
    a.download = `dna-${(j.dna?.company?.brand || j.dna?.company?.name || "doanh-nghiep").replace(/\s+/g, "-")}.json`;
    a.click();
  };
  const dn = draft ?? {};
  return (
    <Modal open={open} onClose={onClose} wide title="Nạp DNA doanh nghiệp" footer={draft
      ? <><Button onClick={() => setDraft(null)}>Làm lại</Button><Button variant="primary" loading={busy === "save"} onClick={() => save(draft, "intake")}>Lưu thay toàn bộ DNA</Button></>
      : <Button onClick={onClose}>Đóng</Button>}>
      {!draft ? (
        <div className="space-y-5">
          <div className="space-y-3 rounded-xl border border-line p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-blue-600" />AI đọc website / tài liệu → điền DNA</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Link website doanh nghiệp</label>
              <input className={inputCls} placeholder="VD: nguyentatkiem.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <p className="mt-1 text-xs text-muted">AI tự đọc trang chủ + trang giới thiệu, khóa học / sản phẩm, bảng giá, liên hệ. Có thể dùng một mình hoặc kèm tài liệu bên dưới.</p>
            </div>
            <p className="text-xs text-muted">Dán hồ sơ công ty, bảng sản phẩm/giá, chân dung khách hàng, quy định thương hiệu… hoặc tải file (.docx, .txt, .md, .rtf, .html). DNA Agent chỉ ghi điều tài liệu có; chỗ chưa chắc đưa vào “Điều chờ xác nhận”.</p>
            <textarea rows={8} className={inputCls} placeholder="Dán nội dung tài liệu vào đây…" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs hover:bg-soft"><FileUp className="h-4 w-4" />{busy === "upload" ? "Đang tải…" : file ? file.name : "Tải tài liệu"}<input type="file" className="hidden" accept=".docx,.doc,.txt,.md,.rtf,.html,.htm,.odt,.json,.csv" onChange={(e) => pickDoc(e.target.files?.[0])} /></label>
              <Button variant="primary" icon={Sparkles} loading={busy === "ai"} disabled={!text.trim() && !file && !website.trim()} onClick={runAi}>AI soạn DNA</Button>
              <span className="text-xs text-muted">mất khoảng 1–2 phút</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-line p-3 text-sm hover:bg-soft"><span className="flex items-center gap-2 font-medium text-ink"><Upload className="h-4 w-4" />Nhập file DNA (.json)</span><span className="text-xs text-muted">Từ máy khác / bản đã xuất</span><input type="file" accept=".json" className="hidden" onChange={(e) => importJson(e.target.files?.[0])} /></label>
            <button onClick={exportJson} className="flex flex-col gap-1 rounded-xl border border-line p-3 text-left text-sm hover:bg-soft"><span className="flex items-center gap-2 font-medium text-ink"><Download className="h-4 w-4" />Xuất DNA hiện tại</span><span className="text-xs text-muted">Lưu file để cài máy khác</span></button>
            <button onClick={() => setConfirmBlank(true)} className="flex flex-col gap-1 rounded-xl border border-line p-3 text-left text-sm hover:bg-soft"><span className="flex items-center gap-2 font-medium text-ink"><Plus className="h-4 w-4" />Bắt đầu DNA trống</span><span className="text-xs text-muted">Cho doanh nghiệp mới cài</span></button>
          </div>
          <Modal open={confirmBlank} onClose={() => setConfirmBlank(false)} title="Bắt đầu DNA trống?" footer={<><Button onClick={() => setConfirmBlank(false)}>Huỷ</Button><Button variant="danger" loading={busy === "save"} onClick={async () => { setConfirmBlank(false); setBusy("save"); try { await api.post("dna/blank"); toast("Đã tạo DNA trống — điền từng mục hoặc dùng AI đọc tài liệu"); onSaved(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } }}>Tạo DNA trống</Button></>}>
            <p className="text-sm text-ink">DNA hiện tại được lưu vào lịch sử phiên bản (khôi phục được). Agent sẽ chạy theo DNA trống cho tới khi Sếp điền.</p>
          </Modal>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {readPages.length > 0 && (
            <div className="rounded-xl border border-line px-3 py-2 text-xs text-muted">
              <p className="font-medium text-ink">Đã đọc {readPages.length} trang website:</p>
              <ul className="mt-1 space-y-0.5">{readPages.map((p) => <li key={p.url} className="truncate">• <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{p.title || p.url}</a></li>)}</ul>
            </div>
          )}
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Bản nháp — xem lại trước khi lưu. Lưu sẽ thay TOÀN BỘ DNA hiện tại (bản cũ vẫn ở Lịch sử phiên bản). Sau khi lưu, sửa từng mục bằng nút “Chỉnh sửa”.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Preview label="Thương hiệu" value={[dn.company?.brand || dn.company?.name, dn.company?.industry, dn.company?.website].filter(Boolean).join(" · ")} />
            <Preview label="CEO / người đại diện" value={[dn.spokesperson?.name || dn.company?.ceo, dn.spokesperson?.gender && `giọng ${dn.spokesperson.gender}`, dn.spokesperson?.region && `miền ${dn.spokesperson.region}`].filter(Boolean).join(" · ")} />
            <Preview label="Định vị" value={dn.positioning} />
            <Preview label="Xưng hô" value={dn.voice ? `“${dn.voice.selfPronoun || "em"}” / “${dn.voice.customerPronoun || "anh/chị"}”` : ""} />
            <Preview label={`Sản phẩm (${(dn.products ?? []).length})`} value={(dn.products ?? []).map((p: any) => `${p.name}${p.price ? ` · ${vndFull(p.price)}` : ""}`).join("\n")} />
            <Preview label={`Khách hàng (${(dn.audience ?? []).length})`} value={(dn.audience ?? []).map((a: any) => a.name).join("\n")} />
            <Preview label="Ưu đãi mồi / CTA" value={[dn.leadMagnet, dn.cta?.text, dn.cta?.link].filter(Boolean).join("\n")} />
            <Preview label={`Điều chờ xác nhận (${(dn.pendingConfirmations ?? []).length})`} value={(dn.pendingConfirmations ?? []).join("\n")} />
          </div>
        </div>
      )}
    </Modal>
  );
}
function Preview({ label, value }: { label: string; value?: string }) {
  return <div className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 whitespace-pre-line text-ink">{value || <span className="text-muted">— (tài liệu không có)</span>}</p></div>;
}
