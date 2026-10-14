import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Ban, Building2, CheckCircle2, Download, FileJson, FileUp, Gem, Globe, History, Loader2, Megaphone, Mic, MousePointerClick, Package, Pencil, Plus, Sparkles, Tag, Target, Trash2, Truck, Upload, Users, X } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo, vnd, vndFull } from "../lib/format";
import { AlertList, Alert, Avatar, Badge, Button, Card, ConfirmDialog, Empty, ExpandableText, ExternalLink, Field, KeyValue, Loading, Modal, MoneyInput, PageHeader, Progress, Tabs, cx, inputCls, useToast } from "../components/ui";
import { PancakeMapPanel } from "../components/PancakeOrders";

const SECTION_LABEL: Record<string, string> = {
  company: "Thông tin công ty", positioning: "Định vị", audience: "Khách hàng mục tiêu", products: "Sản phẩm/Dịch vụ", offers: "Ưu đãi",
  voice: "Giọng điệu thương hiệu", differentiators: "Giá trị khác biệt", channels: "Kênh truyền thông", goals: "Mục tiêu kinh doanh", forbiddenClaims: "Tuyên bố bị cấm",
  spokesperson: "Người đại diện & xưng hô", cta: "Lời kêu gọi chính", pendingConfirmations: "Điều chờ xác nhận", bannedChars: "Ký tự cấm",
};
type EditKey = "brand" | "audience" | "differentiators" | "voice" | "products" | "forbiddenClaims" | "goals" | "offers" | "channels" | "spokesperson" | "cta" | "pendingConfirmations" | "bannedChars";
/** Which editor a missing section of the completeness meter opens. */
const SECTION_EDITOR: Record<string, EditKey> = {
  company: "brand", positioning: "brand", audience: "audience", products: "products", offers: "offers", voice: "voice", spokesperson: "spokesperson",
  cta: "cta", differentiators: "differentiators", channels: "channels", goals: "goals", forbiddenClaims: "forbiddenClaims",
};
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const priceText = (p: any) => (p.price == null ? "Liên hệ" : p.price ? vndFull(p.price) : "Miễn phí");

export function Dna() {
  const { data: d, reload } = useApi<any>("dna");
  const { data: ov } = useApi<any>("overview", ["metrics."]);
  const { data: pk } = useApi<any>("pancake/overview", ["order.", "approval.decided", "metrics.updated"]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ key: EditKey; draft: any; initial: string; focus?: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [history, setHistory] = useState(false);
  // ?import=1 (vừa tạo doanh nghiệp mới) → mở luôn hộp Nạp DNA.
  const [intake, setIntake] = useState(() => new URLSearchParams(window.location.search).get("import") === "1");
  if (!d) return <Loading />;
  const dna = d.data ?? {};
  const goals = dna.goals ?? {};
  const yearTarget = goals.yearTarget ?? ov?.goal?.yearTarget ?? 0;
  const runRate = ov?.goal?.runRate ?? goals.currentRunRate ?? 0;
  const goalPct = yearTarget ? Math.round((runRate / yearTarget) * 100) : 0;
  const dirty = !!edit && JSON.stringify(edit.draft) !== edit.initial;
  const pancakeOn = !!pk?.connection;
  const sections: { key: string; done: boolean }[] = d.sections ?? [];
  const doneCount = sections.filter((s) => s.done).length;
  const pendingN = (dna.pendingConfirmations ?? []).length;
  const comp = d.completeness ?? 0;
  const activeV = (d.versions ?? []).find((v: any) => v.status === "active") ?? (d.versions ?? [])[0];

  const open = (key: EditKey, focus?: number) => {
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
    setEdit({ key, draft: draft[key], initial: JSON.stringify(draft[key]), focus });
  };
  /** Add-product shortcut: opens the product editor with a fresh product already expanded. */
  const addProduct = () => {
    const base = (dna.products ?? []).map((p: any) => ({ ...p, aliases: (p.aliases ?? []).join(", ") }));
    const draft = [...base, { key: `sp-${Date.now()}`, name: "", summary: "", price: 0, sample: false }];
    setEdit({ key: "products", draft, initial: JSON.stringify(base), focus: draft.length - 1 });
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
  const tryClose = () => { if (dirty) setDiscard(true); else setEdit(null); };

  const editBtn = (key: EditKey, label = "Sửa", aria?: string) => <Button size="sm" icon={Pencil} onClick={() => open(key)} aria-label={aria ?? `Chỉnh sửa ${SECTION_LABEL[key] ?? label}`}>{label}</Button>;
  const setDraft = (draft: any) => setEdit((e) => (e ? { ...e, draft } : e));
  const brandName = dna.company?.brand || dna.company?.name || "Doanh nghiệp";

  return (
    <div className="space-y-6">
      <PageHeader title="Mục tiêu & DNA" subtitle="Hồ sơ doanh nghiệp mà mọi Agent AI đọc: chat, chăm khách, nội dung, video. Đổi DNA là cả hệ thống chạy theo doanh nghiệp mới."
        actions={<Button variant="primary" icon={Sparkles} onClick={() => setIntake(true)}>Nạp DNA</Button>} />

      {d.warnings?.length > 0 && <AlertList items={d.warnings} noun="mục cần CEO xác nhận" action={<Button size="sm" onClick={() => open("products")}>Cập nhật giá</Button>} />}

      {/* ---------- Overview: brand + completeness + version ---------- */}
      <Card className="overflow-hidden">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-8">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={brandName} size={56} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <h2 className="break-words text-xl font-bold leading-tight tracking-tight text-ink">{brandName}</h2>
              <p className="break-words text-sm text-muted">{[dna.company?.industry, dna.company?.ceo && `CEO ${dna.company.ceo}`].filter(Boolean).join(" · ") || "Chưa có ngành / CEO"}</p>
              {dna.company?.website && <ExternalLink href={dna.company.website} />}
              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                {activeV ? <Badge tone="green" dot>Phiên bản {activeV.version} · đang dùng</Badge> : <Badge tone="gray">Chưa có phiên bản</Badge>}
                {activeV && <span className="text-xs text-muted">cập nhật {timeAgo(activeV.created_at)} · {activeV.created_by}</span>}
              </div>
              <div className="-ml-2.5 pt-1"><Button size="sm" variant="ghost" icon={History} onClick={() => setHistory(true)}>Lịch sử phiên bản ({(d.versions ?? []).length})</Button></div>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Mức độ hoàn thiện DNA</p>
                <p className="text-xs text-muted">{doneCount}/{sections.length} nhóm thông tin đã điền{pendingN > 0 ? ` · trừ điểm vì còn ${pendingN} điều chờ xác nhận` : ""}</p>
              </div>
              <p className={cx("text-3xl font-bold tabular-nums", comp >= 90 ? "text-ok-ink" : "text-warn-ink")}>{comp}%</p>
            </div>
            <Progress value={comp} tone={comp >= 90 ? "green" : "amber"} className="h-2.5" label="Mức độ hoàn thiện DNA" />
            <ul className="flex flex-wrap gap-1.5" aria-label="Các nhóm thông tin DNA">
              {sections.map((s) => {
                const ed = SECTION_EDITOR[s.key];
                return (
                  <li key={s.key}>
                    {s.done
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok-ink"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{SECTION_LABEL[s.key] ?? s.key}</span>
                      : <button type="button" onClick={() => ed && open(ed)} title="Chưa điền — bấm để điền" className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-warn/60 px-2.5 py-1 text-xs font-medium text-warn-ink hover:bg-warn-soft"><Plus className="h-3.5 w-3.5" aria-hidden />{SECTION_LABEL[s.key] ?? s.key}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      {/* ---------- Goals ---------- */}
      <Card icon={Target} title="Mục tiêu kinh doanh 12 tháng" description="Agent dùng mục tiêu này để chọn việc ưu tiên và đo tiến độ." action={editBtn("goals")}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Metric label="Mục tiêu năm" value={yearTarget ? vnd(yearTarget) : "Chưa đặt"} muted={!yearTarget} />
          <Metric label="Run-rate hiện tại" value={vnd(runRate)} />
          <Metric label="Điểm xuất phát" value={goals.currentRunRate ? vnd(goals.currentRunRate) : "Chưa đặt"} muted={!goals.currentRunRate} />
        </div>
        <div className="mt-5 space-y-2">
          <div className="flex justify-between gap-3 text-sm"><span className="font-medium text-ink">Tiến độ so với mục tiêu</span><span className="tabular-nums text-muted">{goalPct}%</span></div>
          <Progress value={goalPct} tone={goalPct >= 100 ? "green" : "blue"} label="Tiến độ so với mục tiêu" />
          {goals.currentRunRate > 0 && yearTarget > 0 && <p className="text-xs text-muted">Cần tăng {Math.round((yearTarget / goals.currentRunRate - 1) * 100)}% so với mức {vnd(goals.currentRunRate)}/năm · còn thiếu {vnd(Math.max(0, yearTarget - runRate))} run-rate</p>}
          {!yearTarget && <p className="text-xs text-muted">Đặt mục tiêu năm để thấy tiến độ và khoảng cách cần bù.</p>}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-xl bg-soft p-3.5"><p className="text-xs text-muted">Nỗi đau lớn nhất</p><p className="mt-1 break-words text-sm font-medium text-ink">{goals.painPoint || "—"}</p></div>
          <div className="min-w-0 rounded-xl bg-soft p-3.5"><p className="text-xs text-muted">Đối thủ chính</p><div className="mt-1.5 flex flex-wrap gap-1.5">{(goals.competitors ?? []).length ? goals.competitors.map((c: string) => <Badge key={c} tone="red">{c}</Badge>) : <span className="text-sm text-muted">—</span>}</div></div>
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ---------- Brand ---------- */}
        <Card icon={Building2} title="Thương hiệu" description="Tên, định vị và điểm khác biệt." action={editBtn("brand")}>
          <KeyValue labelWidth="6.5rem" items={[
            { label: "Tên", value: dna.company?.name && <span className="font-medium">{dna.company.name}</span> },
            { label: "Website", value: <ExternalLink href={dna.company?.website} /> },
            { label: "Ngành", value: dna.company?.industry },
            { label: "CEO", value: dna.company?.ceo },
            { label: "Quy mô", value: dna.company?.scale && <ExpandableText lines={2} textClass="text-ink">{dna.company.scale}</ExpandableText> },
          ]} />
          <div className="mt-5 space-y-4 border-t border-line pt-4">
            <TextBlock label="Định vị" text={dna.positioning} />
            {dna.mission && <TextBlock label="Sứ mệnh" text={dna.mission} />}
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <BlockHead icon={Gem} title="Giá trị khác biệt" action={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => open("differentiators")} aria-label="Chỉnh sửa giá trị khác biệt">Sửa</Button>} />
            <BulletList items={dna.differentiators} limit={4} empty="Chưa có giá trị khác biệt." />
          </div>
        </Card>

        {/* ---------- Audience ---------- */}
        <Card icon={Users} tone="violet" title="Khách hàng mục tiêu" description="Chân dung khách để Agent viết đúng nỗi đau và mong muốn." action={editBtn("audience")}>
          {(dna.audience ?? []).length === 0 ? <Empty icon={Users} title="Chưa có chân dung khách hàng" action={<Button size="sm" variant="primary" icon={Plus} onClick={() => open("audience")}>Thêm nhóm khách hàng</Button>}>Mô tả từng nhóm khách và nỗi đau của họ để nội dung trúng đích hơn.</Empty> : (
            <div className="space-y-3">{dna.audience.map((a: any) => (
              <div key={a.name} className="min-w-0 rounded-xl border border-line p-4">
                <p className="break-words text-[15px] font-semibold text-ink">{a.name}</p>
                <div className="mt-2.5 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><p className="mb-1 text-xs font-semibold text-danger-ink">Nỗi đau</p><BulletList items={a.pains} tone="red" limit={3} empty="—" /></div>
                  <div className="min-w-0"><p className="mb-1 text-xs font-semibold text-ok-ink">Mong muốn</p><BulletList items={a.goals} tone="green" limit={3} empty="—" /></div>
                </div>
              </div>))}</div>
          )}
        </Card>
      </div>

      {/* ---------- Products ---------- */}
      <Card icon={Package} tone="amber" title={`Sản phẩm / Dịch vụ (${(dna.products ?? []).length})`} description="Agent chỉ báo giá và đưa link theo đúng danh sách này."
        action={<><Button size="sm" icon={Plus} onClick={addProduct}>Thêm sản phẩm</Button><Button size="sm" icon={Pencil} onClick={() => open("products")} aria-label="Chỉnh sửa toàn bộ sản phẩm">Sửa tất cả</Button></>}>
        {(dna.products ?? []).length === 0 ? <Empty icon={Package} title="Chưa có sản phẩm / dịch vụ" action={<Button size="sm" variant="primary" icon={Plus} onClick={addProduct}>Thêm sản phẩm đầu tiên</Button>}>Không có sản phẩm thì Agent không thể báo giá hay gắn link bán.</Empty> : (
          <ul className="space-y-3">
            {(dna.products ?? []).map((p: any, i: number) => <li key={p.key ?? p.name}><ProductRow p={p} pancakeOn={pancakeOn} onEdit={() => open("products", i)} /></li>)}
          </ul>
        )}
        {/* Ghép sản phẩm với mẫu mã Pancake POS (ẩn khi chưa kết nối Pancake); lưu vào chính sản phẩm trong DNA. */}
        <PancakeMapPanel showOrders={false} onChanged={reload} defaultOpen={new URLSearchParams(window.location.search).get("pancake") === "map"} />
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ---------- Voice ---------- */}
        <Card icon={Megaphone} tone="pink" title="Giọng điệu thương hiệu" description="Cách thương hiệu nói chuyện trong mọi nội dung." action={editBtn("voice")}>
          {(dna.voice?.style ?? []).length > 0 ? <div className="flex flex-wrap gap-1.5">{dna.voice.style.map((s: string) => <Badge key={s} tone="violet">{s}</Badge>)}</div> : <p className="text-sm text-muted">Chưa mô tả phong cách.</p>}
          {dna.voice?.sample && <blockquote className="mt-3 break-words rounded-r-xl border-l-4 border-violet-400 bg-soft px-3.5 py-2.5 text-sm italic text-ink">“{dna.voice.sample}”</blockquote>}
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0"><p className="mb-1.5 text-xs font-semibold text-ok-ink">Nên làm</p><BulletList items={dna.voice?.do} tone="green" limit={4} empty="—" /></div>
            <div className="min-w-0"><p className="mb-1.5 text-xs font-semibold text-danger-ink">Nên tránh</p><BulletList items={dna.voice?.dont} tone="red" limit={4} empty="—" /></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
            <span className="mr-1">Kênh:</span>{(dna.channels ?? []).length ? dna.channels.map((c: string) => <Badge key={c}>{c}</Badge>) : "—"}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => open("channels")} aria-label="Chỉnh sửa kênh truyền thông">Sửa kênh</Button>
          </div>
        </Card>

        {/* ---------- Spokesperson ---------- */}
        <Card icon={Mic} tone="violet" title="Người đại diện & xưng hô" description="Gương mặt, giọng đọc và cách gọi khách." action={editBtn("spokesperson")}>
          <KeyValue labelWidth="8rem" items={[
            { label: "Gương mặt video", value: (dna.spokesperson?.name || dna.company?.ceo) && <span className="font-medium">{dna.spokesperson?.name || dna.company?.ceo}</span> },
            { label: "Giọng đọc", value: dna.spokesperson?.voiceDesc || [dna.spokesperson?.gender && `giọng ${dna.spokesperson.gender}`, dna.spokesperson?.region && `miền ${dna.spokesperson.region}`, dna.spokesperson?.age && `${dna.spokesperson.age} tuổi`].filter(Boolean).join(", ") },
            { label: "Xưng hô với khách", value: <>tự xưng “{dna.voice?.selfPronoun || "em"}”, gọi khách “{dna.voice?.customerPronoun || "anh/chị"}”</> },
          ]} />
          <p className="mt-4 rounded-xl bg-soft px-3.5 py-2.5 text-xs leading-relaxed text-muted">Video nhân hiệu dùng người này làm gương mặt và giọng đọc. Chat, follow-up và chăm khách dùng cách xưng hô này.</p>
        </Card>

        {/* ---------- Offers & CTA ---------- */}
        <Card icon={MousePointerClick} tone="green" title="Ưu đãi & lời kêu gọi" description="Thứ Agent đưa ra để khách để lại thông tin hoặc chốt đơn." action={editBtn("cta", "Sửa CTA", "Chỉnh sửa lời kêu gọi chính")}>
          <KeyValue labelWidth="8rem" items={[
            { label: "Ưu đãi mồi", value: dna.leadMagnet },
            { label: "CTA", value: dna.cta?.text },
            { label: "Link chính", value: <ExternalLink href={dna.cta?.link} /> },
          ]} />
          <p className="mt-3 text-xs leading-relaxed text-muted">Follow-up chat mời khách bằng ưu đãi mồi. Chăm khách từ bình luận gửi link chính khi sản phẩm chưa có link riêng.</p>
          <div className="mt-4 border-t border-line pt-4">
            <BlockHead icon={Tag} title="Ưu đãi đang áp dụng" action={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => open("offers")} aria-label="Chỉnh sửa ưu đãi đang áp dụng">Sửa</Button>} />
            <BulletList items={dna.offers} limit={4} empty="Chưa có ưu đãi nào đang áp dụng." />
          </div>
        </Card>

        {/* ---------- Forbidden ---------- */}
        <Card icon={Ban} tone="red" title="Điều cấm" description="Review Agent chặn mọi nội dung chứa các cụm này trước khi đến bàn Sếp." action={editBtn("forbiddenClaims")}>
          <p className="mb-2 text-xs font-semibold text-ink">Tuyên bố bị cấm</p>
          {(dna.forbiddenClaims ?? []).length ? <div className="flex flex-wrap gap-1.5">{dna.forbiddenClaims.map((c: string) => <Badge key={c} tone="red" wrap>{c}</Badge>)}</div> : <p className="text-sm text-muted">Chưa có tuyên bố nào bị cấm.</p>}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
            <span className="mr-1">Ký tự cấm:</span>{(dna.bannedChars ?? []).length ? dna.bannedChars.map((c: string) => <Badge key={c}>{c}</Badge>) : "—"}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => open("bannedChars")} aria-label="Chỉnh sửa ký tự cấm">Sửa</Button>
          </div>
        </Card>
      </div>

      {/* ---------- Pending confirmations ---------- */}
      <Card icon={AlertTriangle} tone="amber" title={`Điều chờ xác nhận (${pendingN})`} description="Agent không khẳng định những điều này (số liệu, giá, USP…) cho tới khi Sếp xác nhận và xoá khỏi danh sách." action={editBtn("pendingConfirmations")}>
        {pendingN === 0 ? <p className="flex items-center gap-2 text-sm text-ok-ink"><CheckCircle2 className="h-4 w-4" aria-hidden />Không còn điều nào chờ xác nhận.</p> : (
          <ul className="space-y-2">{dna.pendingConfirmations.map((x: string) => <li key={x} className="flex gap-2.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" aria-hidden /><span className="min-w-0 break-words">{x}</span></li>)}</ul>
        )}
      </Card>

      <DnaIntake open={intake} onClose={() => setIntake(false)} onSaved={() => { setIntake(false); reload(); }} />

      {/* ---------- Version history ---------- */}
      <Modal open={history} onClose={() => setHistory(false)} title="Lịch sử phiên bản DNA" description="Mỗi lần lưu tạo một phiên bản mới; bản cũ được giữ lại.">
        <ul className="divide-y divide-line">{(d.versions ?? []).map((v: any) => (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
            <span className="font-semibold text-ink">Phiên bản {v.version}</span>
            <Badge tone={v.status === "active" ? "green" : "gray"} dot>{v.status === "active" ? "Đang dùng" : "Lưu trữ"}</Badge>
            <span className="min-w-0 basis-full text-xs text-muted sm:ml-auto sm:basis-auto">bởi {v.created_by} · {timeAgo(v.created_at)}</span>
          </li>))}</ul>
      </Modal>

      {/* ---------- Section editor ---------- */}
      <Modal open={!!edit} onClose={tryClose} closeOnBackdrop={false} size={edit?.key === "products" || edit?.key === "audience" ? "lg" : "md"}
        title={edit ? `Chỉnh sửa: ${edit.key === "brand" ? "Thương hiệu" : SECTION_LABEL[edit.key]}` : ""}
        description="Lưu sẽ tạo phiên bản DNA mới; Agent dùng bản mới ngay."
        footer={<>
          {dirty && <span className="mr-auto flex items-center gap-2 text-xs font-medium text-warn-ink max-sm:order-first"><span className="h-2 w-2 rounded-full bg-warn" />Có thay đổi chưa lưu</span>}
          <Button onClick={tryClose} disabled={saving}>Hủy</Button>
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Lưu phiên bản mới</Button>
        </>}>
        {edit && <Editor k={edit.key} draft={edit.draft} set={setDraft} focus={edit.focus} />}
      </Modal>
      <ConfirmDialog open={discard} title="Bỏ các thay đổi chưa lưu?" tone="danger" confirmLabel="Bỏ thay đổi" cancelLabel="Tiếp tục chỉnh sửa" onCancel={() => setDiscard(false)} onConfirm={() => { setDiscard(false); setEdit(null); }}>
        Những gì Sếp vừa sửa trong mục này sẽ mất.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------- Product row (list item)
function ProductRow({ p, pancakeOn, onEdit }: { p: any; pancakeOn: boolean; onEdit: () => void }) {
  const unverified = p.sample || p.verified === false;
  return (
    <div className="min-w-0 rounded-xl border border-line bg-card p-4 transition-colors hover:border-line-strong">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="min-w-0">
            <h3 className="break-words text-[15px] font-semibold leading-snug text-ink">{p.name}</h3>
            {p.key && <p className="truncate font-mono text-[11px] text-muted" title={p.key}>{p.key}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {p.delivery === "ship" && <Badge tone="blue"><Truck className="h-3 w-3" aria-hidden />Giao hàng</Badge>}
            {p.delivery === "none" && <Badge tone="gray">Không giao hàng</Badge>}
            {p.format && <Badge>{p.format}</Badge>}
            {unverified && <Badge tone="amber" dot>Chờ xác nhận giá</Badge>}
            {p.pancake ? <Badge tone="violet" title={p.pancake.variationName ?? p.pancake.variationId}>Pancake ✓ {p.pancake.variationName ?? ""}</Badge> : pancakeOn && <Badge tone="amber">Chưa ghép Pancake</Badge>}
          </div>
          {p.summary && <ExpandableText lines={2}>{p.summary}</ExpandableText>}
          {(p.link || p.shortLink || p.commentText) && (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
              {p.link && <><dt className="text-muted">Link sản phẩm</dt><dd className="min-w-0"><ExternalLink href={p.link} className="text-xs" /></dd></>}
              {p.shortLink && <><dt className="text-muted">Link dưới bình luận</dt><dd className="min-w-0"><ExternalLink href={p.shortLink} className="text-xs" /></dd></>}
              {p.commentText && <><dt className="text-muted">Câu bình luận</dt><dd className="min-w-0 truncate text-ink" title={p.commentText}>{p.commentText}</dd></>}
            </dl>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
          <p className={cx("text-base font-bold tabular-nums", p.price == null ? "text-muted" : "text-ink")}>{priceText(p)}</p>
          <Button size="sm" icon={Pencil} onClick={onEdit} aria-label={`Sửa sản phẩm ${p.name}`}>Sửa</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Editors
function Editor({ k, draft, set, focus }: { k: EditKey; draft: any; set: (d: any) => void; focus?: number }) {
  if (k === "brand") return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {([["name", "Tên thương hiệu"], ["website", "Website"], ["industry", "Ngành"], ["ceo", "CEO"], ["scale", "Quy mô"]] as const).map(([f, l]) => (
          <Field key={f} label={l}><input className={inputCls} value={draft[f] ?? ""} onChange={(e) => set({ ...draft, [f]: e.target.value })} /></Field>))}
      </div>
      <Field label="Định vị" hint="Một đoạn ngắn: bạn là ai, giúp ai, khác đối thủ ở đâu."><textarea rows={3} className={inputCls} value={draft.positioning} onChange={(e) => set({ ...draft, positioning: e.target.value })} /></Field>
      <Field label="Sứ mệnh" optional><textarea rows={2} className={inputCls} value={draft.mission} onChange={(e) => set({ ...draft, mission: e.target.value })} /></Field>
    </div>
  );
  if (k === "voice") return (
    <div className="space-y-4">
      <Field label="Phong cách" hint="Các từ khoá cách nhau bằng dấu phẩy. Ví dụ: thực chiến, cảm hứng, thẳng thắn"><input className={inputCls} value={draft.style} onChange={(e) => set({ ...draft, style: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nên làm" hint="Mỗi dòng một ý"><textarea rows={4} className={inputCls} value={draft.do} onChange={(e) => set({ ...draft, do: e.target.value })} /></Field>
        <Field label="Nên tránh" hint="Mỗi dòng một ý"><textarea rows={4} className={inputCls} value={draft.dont} onChange={(e) => set({ ...draft, dont: e.target.value })} /></Field>
      </div>
      <Field label="Câu mẫu" hint="Một câu thể hiện đúng giọng thương hiệu"><textarea rows={2} className={inputCls} value={draft.sample} onChange={(e) => set({ ...draft, sample: e.target.value })} /></Field>
    </div>
  );
  if (k === "spokesperson") return (
    <div className="space-y-6">
      <Group title="Gương mặt & giọng đọc video">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Người đại diện" hint="Để trống = dùng CEO"><input className={inputCls} value={draft.name ?? ""} onChange={(e) => set({ ...draft, name: e.target.value })} /></Field>
          <Field label="Tuổi"><input className={inputCls} value={draft.age ?? ""} onChange={(e) => set({ ...draft, age: e.target.value })} /></Field>
          <Field label="Giới tính giọng"><select className={inputCls} value={draft.gender ?? ""} onChange={(e) => set({ ...draft, gender: e.target.value })}><option value="">—</option><option value="nam">Nam</option><option value="nữ">Nữ</option></select></Field>
          <Field label="Miền"><select className={inputCls} value={draft.region ?? ""} onChange={(e) => set({ ...draft, region: e.target.value })}><option value="">—</option><option value="Bắc">Bắc</option><option value="Trung">Trung</option><option value="Nam">Nam</option></select></Field>
        </div>
        <Field label="Mô tả giọng" optional hint="Ví dụ: giọng nam miền Bắc, 40 tuổi, trầm, chắc"><input className={inputCls} value={draft.voiceDesc ?? ""} onChange={(e) => set({ ...draft, voiceDesc: e.target.value })} /></Field>
      </Group>
      <Group title="Cách xưng hô với khách" divided>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bot / nhân viên tự xưng"><input className={inputCls} value={draft.selfPronoun} onChange={(e) => set({ ...draft, selfPronoun: e.target.value })} placeholder="em / mình / shop" /></Field>
          <Field label="Gọi khách là"><input className={inputCls} value={draft.customerPronoun} onChange={(e) => set({ ...draft, customerPronoun: e.target.value })} placeholder="anh/chị / bạn / quý khách" /></Field>
        </div>
      </Group>
    </div>
  );
  if (k === "cta") return (
    <div className="space-y-4">
      <Field label="Ưu đãi mồi" hint="Ví dụ: Buổi học thử miễn phí / Voucher 10% đơn đầu / Tư vấn 1-1 miễn phí"><input className={inputCls} value={draft.leadMagnet} onChange={(e) => set({ ...draft, leadMagnet: e.target.value })} /></Field>
      <Field label="Câu kêu gọi chính"><input className={inputCls} value={draft.text} onChange={(e) => set({ ...draft, text: e.target.value })} /></Field>
      <Field label="Link chính" hint="Dùng khi sản phẩm chưa có link riêng"><input className={inputCls} value={draft.link} onChange={(e) => set({ ...draft, link: e.target.value })} placeholder="https://…" /></Field>
    </div>
  );
  if (k === "goals") return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mục tiêu năm" hint={Number(draft.yearTarget) ? `= ${vnd(Number(draft.yearTarget))}` : "Doanh thu muốn đạt trong 12 tháng"}><MoneyInput value={Number(draft.yearTarget) || null} onChange={(v) => set({ ...draft, yearTarget: v ?? 0 })} placeholder="VD: 12.000.000.000" /></Field>
        <Field label="Run-rate xuất phát" hint={Number(draft.currentRunRate) ? `= ${vnd(Number(draft.currentRunRate))}` : "Doanh thu năm hiện tại, quy đổi"}><MoneyInput value={Number(draft.currentRunRate) || null} onChange={(v) => set({ ...draft, currentRunRate: v ?? 0 })} placeholder="VD: 3.000.000.000" /></Field>
      </div>
      <Field label="Nỗi đau lớn nhất"><input className={inputCls} value={draft.painPoint} onChange={(e) => set({ ...draft, painPoint: e.target.value })} /></Field>
      <Field label="Đối thủ" hint="Cách nhau bằng dấu phẩy"><input className={inputCls} value={draft.competitors} onChange={(e) => set({ ...draft, competitors: e.target.value })} /></Field>
    </div>
  );
  if (k === "audience") return (
    <div className="space-y-4">
      {draft.length === 0 && <Empty>Chưa có nhóm khách hàng nào. Bấm “Thêm nhóm khách hàng”.</Empty>}
      {draft.map((a: any, i: number) => {
        const upd = (f: string, v: string) => set(draft.map((x: any, j: number) => (j === i ? { ...x, [f]: v } : x)));
        return (
          <div key={i} className="space-y-4 rounded-xl border border-line p-4">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1"><Field label={`Nhóm khách hàng ${i + 1}`}><input className={inputCls} placeholder="VD: Chủ doanh nghiệp nhỏ" value={a.name} onChange={(e) => upd("name", e.target.value)} /></Field></div>
              <Button variant="dangerSoft" icon={Trash2} aria-label={`Xoá nhóm ${a.name || i + 1}`} onClick={() => set(draft.filter((_: any, j: number) => j !== i))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nỗi đau" hint="Mỗi dòng một ý"><textarea rows={4} className={inputCls} value={a.pains} onChange={(e) => upd("pains", e.target.value)} /></Field>
              <Field label="Mong muốn" hint="Mỗi dòng một ý"><textarea rows={4} className={inputCls} value={a.goals} onChange={(e) => upd("goals", e.target.value)} /></Field>
            </div>
          </div>);
      })}
      <Button icon={Plus} onClick={() => set([...draft, { name: "", pains: "", goals: "" }])}>Thêm nhóm khách hàng</Button>
    </div>
  );
  if (k === "products") return <ProductsEditor draft={draft} set={set} focus={focus} />;
  const n = lines(String(draft)).length;
  return <Field label={SECTION_LABEL[k]} hint={`Mỗi dòng một mục · hiện có ${n} mục`}><textarea rows={8} className={inputCls} value={draft} onChange={(e) => set(e.target.value)} /></Field>;
}

/** All products as an accordion: the product you clicked "Sửa" on is open, the rest stay one line each. */
function ProductsEditor({ draft, set, focus }: { draft: any[]; set: (d: any) => void; focus?: number }) {
  const [openIdx, setOpenIdx] = useState<number | null>(focus ?? (draft.length === 1 ? 0 : null));
  const [removing, setRemoving] = useState<number | null>(null);
  useEffect(() => {
    if (focus != null) document.getElementById(`prod-edit-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus]);
  return (
    <div className="space-y-3">
      <Alert tone="info">Khi sửa giá, nhãn “Giá mẫu” được bỏ — Agent sẽ báo giá đúng con số này. Để trống giá = “Liên hệ”.</Alert>
      {draft.map((p: any, i: number) => {
        const upd = (patch: any) => set(draft.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)));
        const isOpen = openIdx === i;
        return (
          <div key={p.key ?? i} id={`prod-edit-${i}`} className={cx("scroll-mt-2 rounded-xl border", isOpen ? "border-blue-500/40 bg-blue-500/[0.03]" : "border-line")}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpenIdx(isOpen ? null : i)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left hover:bg-soft/70">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{p.name || "Sản phẩm mới (chưa đặt tên)"}</span>
                <span className="block truncate text-xs text-muted">{priceText(p)}{p.format ? ` · ${p.format}` : ""}</span>
              </span>
              {p.sample && <Badge tone="amber">Giá mẫu</Badge>}
              <Pencil className={cx("h-4 w-4 shrink-0", isOpen ? "text-blue-600" : "text-muted")} aria-hidden />
            </button>
            {isOpen && (
              <div className="space-y-6 border-t border-line px-4 pb-5 pt-4">
                <Group title="Thông tin cơ bản">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
                    <Field label="Tên sản phẩm" required><input className={inputCls} placeholder="Tên sản phẩm" value={p.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                    <Field label="Giá" hint={p.price == null ? "Đang để trống: hiển thị “Liên hệ”" : p.price === 0 ? "0 đ = Miễn phí" : undefined}>
                      <MoneyInput value={p.price} placeholder="Để trống = liên hệ" onChange={(v) => upd({ price: v, sample: false, verified: true })} />
                    </Field>
                  </div>
                  <Field label="Mô tả ngắn" hint="1–2 câu Agent dùng để giới thiệu sản phẩm"><textarea rows={3} className={inputCls} placeholder="Sản phẩm này giúp ai, đạt được gì?" value={p.summary ?? ""} onChange={(e) => upd({ summary: e.target.value })} /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Hình thức" optional><input className={inputCls} placeholder="Online / Offline / SaaS…" value={p.format ?? ""} onChange={(e) => upd({ format: e.target.value })} /></Field>
                    <Field label="Tên gọi khác" optional hint="Cách nhau bằng dấu phẩy — giúp Agent nhận ra khách nhắc tên khác"><input className={inputCls} placeholder="vd: ABS, khoá AI 3 ngày" value={p.aliases ?? ""} onChange={(e) => upd({ aliases: e.target.value })} /></Field>
                  </div>
                </Group>

                <Group title="Link & bình luận" divided>
                  <Field label="Link sản phẩm" optional><input className={inputCls} inputMode="url" placeholder="https://…" value={p.link ?? ""} onChange={(e) => upd({ link: e.target.value })} /></Field>
                  <Field label="Link gắn dưới bình luận" optional hint="Chỉ điền nếu khác link sản phẩm (vd link affiliate rút gọn). Trống = dùng Link sản phẩm."><input className={inputCls} inputMode="url" placeholder="https://…" value={p.shortLink ?? ""} onChange={(e) => upd({ shortLink: e.target.value })} /></Field>
                  <Field label="Câu bình luận dưới bài" optional hint="Dùng {link} để chèn link vào câu"><input className={inputCls} placeholder="VD: Link đăng ký & ưu đãi: {link}" value={p.commentText ?? ""} onChange={(e) => upd({ commentText: e.target.value })} /></Field>
                </Group>

                <Group title="Giao hàng & Pancake" divided>
                  <Field label="Giao hàng">
                    <select className={inputCls} value={p.delivery ?? ""} onChange={(e) => upd({ delivery: e.target.value })}>
                      <option value="">Tự nhận biết</option>
                      <option value="ship">Giao tận nơi (hàng vật lý — cần địa chỉ)</option>
                      <option value="none">Không giao (khoá học, dịch vụ, online)</option>
                    </select>
                  </Field>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-soft px-3.5 py-3 text-sm">
                    {p.pancake
                      ? <><Badge tone="violet">Pancake: {p.pancake.variationName ?? p.pancake.variationId}</Badge><Button size="sm" variant="ghost" onClick={() => upd({ pancake: null })}>Bỏ ghép</Button></>
                      : <span className="text-muted">Chưa ghép mẫu mã Pancake — ghép ở khung “Ghép sản phẩm Pancake” dưới danh sách sản phẩm.</span>}
                  </div>
                </Group>

                <div className="flex justify-end border-t border-line pt-4">
                  <Button variant="dangerSoft" size="sm" icon={Trash2} onClick={() => setRemoving(i)}>Xoá sản phẩm này</Button>
                </div>
              </div>
            )}
          </div>);
      })}
      <Button icon={Plus} onClick={() => { set([...draft, { key: `sp-${Date.now()}`, name: "", summary: "", price: 0, sample: false }]); setOpenIdx(draft.length); }}>Thêm sản phẩm</Button>
      <ConfirmDialog open={removing != null} title="Xoá sản phẩm này?" tone="danger" confirmLabel="Xoá sản phẩm" onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing != null) { set(draft.filter((_: any, j: number) => j !== removing)); setOpenIdx(null); } setRemoving(null); }}>
        “{removing != null ? draft[removing]?.name || "Sản phẩm chưa đặt tên" : ""}” sẽ bị gỡ khỏi DNA khi Sếp bấm “Lưu phiên bản mới”. Chưa lưu thì chưa mất.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------- Small presentational helpers
/** Titled block of fields inside an editor; `divided` draws a rule above it. */
function Group({ title, divided, children }: { title: string; divided?: boolean; children: ReactNode }) {
  return <section className={cx("space-y-4", divided && "border-t border-line pt-5")}><h4 className="text-sm font-semibold text-ink">{title}</h4>{children}</section>;
}
function Metric({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return <div className="min-w-0"><p className="text-xs text-muted">{label}</p><p className={cx("mt-1 truncate text-xl font-bold tracking-tight", muted ? "text-muted" : "text-ink")}>{value}</p></div>;
}
function TextBlock({ label, text }: { label: string; text?: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-muted">{label}</p>
      {text ? <ExpandableText lines={3} textClass="text-ink">{text}</ExpandableText> : <p className="text-sm text-muted">Chưa có.</p>}
    </div>
  );
}
function BlockHead({ icon: Icon, title, action }: { icon: any; title: string; action?: ReactNode }) {
  return <div className="mb-2 flex min-h-9 items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-muted" aria-hidden />{title}</p>{action}</div>;
}
/** Bullet list that shows `limit` items and folds the rest behind "Xem thêm (n)". */
function BulletList({ items, limit = 5, empty = "—", tone = "blue" }: { items?: string[]; limit?: number; empty?: string; tone?: "blue" | "green" | "red" }) {
  const [all, setAll] = useState(false);
  if (!items?.length) return <p className="text-sm text-muted">{empty}</p>;
  const shown = all ? items : items.slice(0, limit);
  const dot = tone === "green" ? "bg-ok" : tone === "red" ? "bg-danger" : "bg-blue-500";
  return (
    <div className="min-w-0">
      <ul className="space-y-1.5 text-sm">{shown.map((x) => <li key={x} className="flex gap-2.5 text-ink"><span className={cx("mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full", dot)} /><span className="min-w-0 break-words">{x}</span></li>)}</ul>
      {items.length > limit && <button type="button" onClick={() => setAll(!all)} className="-ml-2 mt-1 inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-medium text-blue-700 hover:bg-blue-500/10 dark:text-blue-300" aria-expanded={all}>{all ? "Thu gọn" : `Xem thêm ${items.length - limit} mục`}</button>}
    </div>
  );
}

// ---------------------------------------------------------------- Intake modal
type IntakeTab = "ai" | "json" | "blank";
const AI_STEPS = ["Đang đọc website & tài liệu", "Đang phân tích thương hiệu, sản phẩm, khách hàng", "Đang soạn bản nháp DNA", "Đang kiểm tra lại số liệu & giá"];
const AI_ESTIMATE_S = 110;

/** Nạp DNA cho doanh nghiệp bất kỳ: tài liệu → DNA Agent soạn nháp → xem trước → lưu; hoặc nhập/xuất JSON; hoặc làm từ trống. */
function DnaIntake({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<IntakeTab>("ai");
  const [text, setText] = useState("");
  const [website, setWebsite] = useState("");
  const [readPages, setReadPages] = useState<{ url: string; title: string }[]>([]);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBlank, setConfirmBlank] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (busy !== "ai") { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);
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
    try { const r = await api.post("dna/import", { data, replace: true, source }); toast(`Đã nạp DNA (phiên bản ${r.version}) — các luồng dùng DNA mới từ bây giờ`); setDraft(null); setText(""); setFile(null); setConfirmSave(false); onSaved(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try { const j = JSON.parse(await f.text()); setDraft(j.dna ?? j); setReadPages([]); toast("Đã đọc file — xem lại rồi bấm Lưu"); } catch { toast("File không phải JSON DNA hợp lệ", "err"); }
  };
  const exportJson = async () => {
    try {
      const j = await api.get("dna/export");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
      a.download = `dna-${(j.dna?.company?.brand || j.dna?.company?.name || "doanh-nghiep").replace(/\s+/g, "-")}.json`;
      a.click();
    } catch (e: any) { toast(e.message, "err"); }
  };
  const aiBusy = busy === "ai";
  const canRun = !!(text.trim() || file || website.trim());
  const guardedClose = () => { if (aiBusy) { toast("AI đang soạn DNA — Sếp vui lòng chờ xong rồi hãy đóng", "info"); return; } onClose(); };
  const dn = draft ?? {};
  const step = Math.min(AI_STEPS.length - 1, Math.floor(elapsed / (AI_ESTIMATE_S / AI_STEPS.length)));
  const estPct = Math.min(95, Math.round((elapsed / AI_ESTIMATE_S) * 100));
  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  const footer = draft
    ? <><Button icon={ArrowLeft} onClick={() => { setDraft(null); setReadPages([]); }} disabled={busy === "save"}>Làm lại</Button><Button variant="primary" loading={busy === "save"} onClick={() => setConfirmSave(true)}>Lưu thay toàn bộ DNA</Button></>
    : <><Button onClick={guardedClose} disabled={aiBusy}>Đóng</Button>{tab === "ai" && !aiBusy && <Button variant="primary" icon={Sparkles} disabled={!canRun} onClick={runAi}>AI soạn DNA</Button>}</>;

  return (
    <Modal open={open} onClose={guardedClose} closeOnBackdrop={false} size="lg" title={draft ? "Xem lại bản nháp DNA" : "Nạp DNA doanh nghiệp"}
      description={draft ? "Kiểm tra từng mục rồi mới lưu." : "Cho AI đọc website, tài liệu hoặc nhập file có sẵn để điền DNA nhanh."} footer={footer}>
      {draft ? (
        <DraftPreview dn={dn} readPages={readPages} />
      ) : aiBusy ? (
        <div className="mx-auto max-w-lg space-y-5 py-4 text-center" role="status" aria-live="polite">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-500/10 text-blue-600"><Loader2 className="h-7 w-7 animate-spin" aria-hidden /></span>
          <div>
            <p className="text-lg font-semibold text-ink">AI đang soạn DNA cho Sếp…</p>
            <p className="mt-1 text-sm text-muted">Việc này mất khoảng <b className="text-ink">1,5 – 2 phút</b>. Vui lòng <b className="text-ink">không đóng cửa sổ này</b> hoặc tải lại trang.</p>
          </div>
          <div className="space-y-2">
            <Progress value={estPct} className="h-2.5" label="Tiến độ ước tính" />
            <div className="flex justify-between text-xs text-muted"><span>Đã chờ {mm}</span><span>ước tính {estPct}%</span></div>
          </div>
          <ol className="mx-auto max-w-sm space-y-1.5 text-left text-sm">
            {AI_STEPS.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-2.5", i < step ? "text-ok-ink" : i === step ? "font-medium text-ink" : "text-muted")}>
                {i < step ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : i === step ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" aria-hidden /> : <span className="h-4 w-4 shrink-0 rounded-full border border-line-strong" />}
                {s}
              </li>
            ))}
          </ol>
          {elapsed > 150 && <Alert tone="warn">Lâu hơn dự kiến — website lớn hoặc tài liệu dài thì AI cần thêm thời gian. Cứ để cửa sổ mở.</Alert>}
        </div>
      ) : (
        <div className="space-y-5">
          <Tabs variant="pill" value={tab} onChange={setTab} tabs={[{ value: "ai", label: "AI đọc website" }, { value: "json", label: "Nhập / xuất file" }, { value: "blank", label: "DNA trống" }]} />

          {tab === "ai" && (
            <div className="space-y-5">
              <Alert tone="info">AI chỉ ghi những gì có trong website / tài liệu. Chỗ chưa chắc được đưa vào “Điều chờ xác nhận”. Soạn xong Sếp được xem bản nháp trước khi lưu.</Alert>
              <Field label="Link website doanh nghiệp" optional hint="AI tự đọc trang chủ, giới thiệu, khoá học / sản phẩm, bảng giá, liên hệ. Dùng một mình hoặc kèm tài liệu bên dưới.">
                <div className="relative"><Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><input className={cx(inputCls, "pl-9")} inputMode="url" placeholder="VD: nguyentatkiem.com" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
              </Field>
              <Field label="Tài liệu" optional hint="Dán hồ sơ công ty, bảng sản phẩm / giá, chân dung khách hàng, quy định thương hiệu…">
                <textarea rows={6} className={inputCls} placeholder="Dán nội dung tài liệu vào đây…" value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-soft focus-within:outline focus-within:outline-2 focus-within:outline-blue-500">
                  <FileUp className="h-4 w-4" aria-hidden />{busy === "upload" ? "Đang tải…" : file ? <span className="max-w-[16rem] truncate">{file.name}</span> : "Tải tài liệu lên"}
                  <input type="file" className="sr-only" accept=".docx,.doc,.txt,.md,.rtf,.html,.htm,.odt,.json,.csv" onChange={(e) => pickDoc(e.target.files?.[0])} />
                </label>
                {file && <Button variant="ghost" icon={X} aria-label="Bỏ tài liệu đã chọn" onClick={() => setFile(null)} />}
                <span className="text-xs text-muted">.docx, .txt, .md, .rtf, .html, .json, .csv</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <span className="text-xs text-muted">AI cần khoảng 1,5–2 phút. Đừng đóng cửa sổ khi AI đang chạy.</span>
              </div>
            </div>
          )}

          {tab === "json" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-[7.5rem] cursor-pointer flex-col gap-2 rounded-xl border border-line-strong p-4 hover:bg-soft focus-within:outline focus-within:outline-2 focus-within:outline-blue-500">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Upload className="h-4 w-4" aria-hidden />Nhập file DNA (.json)</span>
                <span className="text-sm text-muted">Từ máy khác hoặc bản đã xuất. Sau khi chọn file, Sếp được xem lại trước khi lưu.</span>
                <input type="file" accept=".json" className="sr-only" onChange={(e) => importJson(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={exportJson} className="flex min-h-[7.5rem] flex-col gap-2 rounded-xl border border-line-strong p-4 text-left hover:bg-soft">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Download className="h-4 w-4" aria-hidden />Xuất DNA hiện tại</span>
                <span className="text-sm text-muted">Lưu thành file .json để sao lưu hoặc cài sang máy khác.</span>
              </button>
            </div>
          )}

          {tab === "blank" && (
            <div className="space-y-4">
              <Alert tone="warn" title="DNA trống thay thế DNA hiện tại">DNA đang dùng được lưu vào lịch sử phiên bản nên vẫn khôi phục được. Agent sẽ chạy theo DNA trống cho tới khi Sếp điền từng mục hoặc nhờ AI đọc tài liệu.</Alert>
              <Button variant="dangerSoft" icon={FileJson} onClick={() => setConfirmBlank(true)}>Bắt đầu DNA trống…</Button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={confirmBlank} title="Bắt đầu DNA trống?" tone="danger" confirmLabel="Tạo DNA trống" loading={busy === "save"} onCancel={() => setConfirmBlank(false)}
        onConfirm={async () => { setBusy("save"); try { await api.post("dna/blank"); setConfirmBlank(false); toast("Đã tạo DNA trống — điền từng mục hoặc dùng AI đọc tài liệu"); onSaved(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } }}>
        DNA hiện tại được lưu vào lịch sử phiên bản (khôi phục được). Agent sẽ chạy theo DNA trống cho tới khi Sếp điền.
      </ConfirmDialog>
      <ConfirmDialog open={confirmSave} title="Thay toàn bộ DNA hiện tại?" confirmLabel="Lưu & thay DNA" loading={busy === "save"} onCancel={() => setConfirmSave(false)} onConfirm={() => save(draft, "intake")}>
        Bản nháp này sẽ thay TOÀN BỘ DNA đang dùng. Bản cũ vẫn nằm trong Lịch sử phiên bản.
      </ConfirmDialog>
    </Modal>
  );
}

function DraftPreview({ dn, readPages }: { dn: any; readPages: { url: string; title: string }[] }) {
  const products: any[] = dn.products ?? [];
  const audience: any[] = dn.audience ?? [];
  const pending: string[] = dn.pendingConfirmations ?? [];
  const brand = [dn.company?.brand || dn.company?.name, dn.company?.industry].filter(Boolean).join(" · ");
  const checks = [brand, dn.positioning, products.length, audience.length, dn.voice, dn.leadMagnet || dn.cta?.text].filter(Boolean).length;
  return (
    <div className="space-y-5 text-sm">
      <Alert tone="warn" title="Đây là bản nháp — chưa được lưu">Lưu sẽ thay TOÀN BỘ DNA hiện tại (bản cũ vẫn ở Lịch sử phiên bản). Sau khi lưu, sửa từng mục bằng nút “Sửa”.</Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={checks >= 5 ? "green" : "amber"} dot>AI điền được {checks}/6 nhóm chính</Badge>
        {pending.length > 0 && <Badge tone="amber">{pending.length} điều cần xác nhận</Badge>}
        {readPages.length > 0 && <Badge tone="blue">Đã đọc {readPages.length} trang website</Badge>}
      </div>
      {readPages.length > 0 && (
        <details className="rounded-xl border border-line px-3.5 py-2.5 text-xs">
          <summary className="font-medium text-ink">Danh sách trang đã đọc ({readPages.length})</summary>
          <ul className="mt-2 space-y-1">{readPages.map((p) => <li key={p.url} className="min-w-0"><ExternalLink href={p.url} className="text-xs">{p.title || p.url}</ExternalLink></li>)}</ul>
        </details>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Preview label="Thương hiệu" value={[dn.company?.brand || dn.company?.name, dn.company?.industry, dn.company?.website].filter(Boolean).join(" · ")} />
        <Preview label="CEO / người đại diện" value={[dn.spokesperson?.name || dn.company?.ceo, dn.spokesperson?.gender && `giọng ${dn.spokesperson.gender}`, dn.spokesperson?.region && `miền ${dn.spokesperson.region}`].filter(Boolean).join(" · ")} />
        <Preview wide label="Định vị" value={dn.positioning} />
        <Preview label="Xưng hô" value={dn.voice ? `Tự xưng “${dn.voice.selfPronoun || "em"}”, gọi khách “${dn.voice.customerPronoun || "anh/chị"}”` : ""} />
        <Preview label="Ưu đãi mồi / CTA" value={[dn.leadMagnet, dn.cta?.text, dn.cta?.link].filter(Boolean).join("\n")} />
        <Preview wide label={`Sản phẩm (${products.length})`} value={products.length ? (
          <ul className="space-y-1.5">{products.map((p) => <li key={p.key ?? p.name} className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words text-ink">{p.name}</span><span className="shrink-0 tabular-nums text-muted">{p.price == null ? "Liên hệ" : p.price ? vndFull(p.price) : "Miễn phí"}</span></li>)}</ul>
        ) : ""} />
        <Preview wide label={`Khách hàng (${audience.length})`} value={audience.length ? <ul className="list-disc space-y-1 pl-4">{audience.map((a) => <li key={a.name} className="break-words">{a.name}</li>)}</ul> : ""} />
        <Preview wide label={`Điều chờ xác nhận (${pending.length})`} value={pending.length ? <ul className="list-disc space-y-1 pl-4">{pending.map((x) => <li key={x} className="break-words">{x}</li>)}</ul> : ""} emptyText="Không có điều nào chờ xác nhận" />
      </div>
    </div>
  );
}
function Preview({ label, value, wide, emptyText }: { label: string; value?: ReactNode; wide?: boolean; emptyText?: string }) {
  return (
    <div className={cx("min-w-0 rounded-xl border p-3.5", value ? "border-line" : "border-dashed border-warn/50 bg-warn-soft/40", wide && "sm:col-span-2")}>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="mt-1 whitespace-pre-line break-words text-ink">{value || <span className="text-muted">{emptyText ?? "Chưa có — tài liệu không đề cập"}</span>}</div>
    </div>
  );
}
