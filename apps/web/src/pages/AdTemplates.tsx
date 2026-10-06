import { useEffect, useState } from "react";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { PlatformNotReady, PlatformTabs, pfLabel, useAdsPlatform, usePlatformStatus, type AdsPf } from "../components/AdsPlatform";
import { ddmm, vndFull } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Toggle, inputCls, useToast } from "../components/ui";

const OBJ: Record<string, string> = { messages: "Tin nhắn (Messenger)", engagement: "Tương tác bài viết", sales: "Chuyển đổi (website, cần pixel)", traffic: "Lượt truy cập website" };
const BLANK = { name: "", platform: "meta", definition: { objective: "messages", audience: { locations: ["VN"], ageMin: 28, ageMax: 55, genders: [] as number[], interests: [] }, budget: { type: "daily", amount: 1_000_000, currency: "VND" }, targetCpa: null, naming: "{date}_{page}_{postId}_{template}", cta: "MESSAGE_PAGE", placements: "auto", note: "", pixelId: null as string | null, conversionEvent: null as string | null, advantageAudience: true } };

export function AdTemplates() {
  const toast = useToast();
  const { data: all, reload } = useApi<any[]>("ad-templates");
  const [pf, setPf] = useAdsPlatform();
  const pst = usePlatformStatus();
  const data = all ? all.filter((t) => t.platform === pf) : null;
  const notReady = pf === "google_ads";
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: opts } = useApi<any>("automation-options");
  const { data: metaOpts } = useApi<any>("ads/meta/options");
  const liveAcc = (opts?.adAccounts ?? []).find((a: any) => a.platform === "meta" && a.mode === "live");
  const [pixels, setPixels] = useState<any[] | null>(null);
  const wantsPixels = edit?.definition?.objective === "sales";
  useEffect(() => {
    if (!wantsPixels || pixels || !liveAcc) return;
    api.get<any[]>(`ads/meta/pixels?adAccountId=${liveAcc.id}`).then(setPixels).catch(() => setPixels([]));
  }, [wantsPixels, liveAcc, pixels]);

  const save = async () => {
    setBusy(true);
    try {
      const d = edit.definition;
      const interests = typeof d.audience.interests === "string" ? d.audience.interests.split(",").map((s: string) => s.trim()).filter(Boolean) : d.audience.interests;
      const body = { name: edit.name, platform: edit.platform, definition: { ...d, targetCpa: d.targetCpa ? Number(d.targetCpa) : null, pixelId: d.objective === "sales" ? d.pixelId || null : null, conversionEvent: d.objective === "sales" ? d.conversionEvent || null : null, audience: { ...d.audience, interests } } };
      await (edit.id ? api.put(`ad-templates/${edit.id}`, body) : api.post("ad-templates", body));
      toast("Đã lưu mẫu quảng cáo"); setEdit(null); reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const setD = (patch: any) => setEdit({ ...edit, definition: { ...edit.definition, ...patch } });
  const setAud = (patch: any) => setD({ audience: { ...edit.definition.audience, ...patch } });

  return (
    <div className="space-y-6">
      <PageHeader title={`Thư viện nội dung · ${pfLabel(pf)}`} subtitle={`Mẫu quảng cáo ${pfLabel(pf)}: mục tiêu, tệp đối tượng, ngân sách — dùng khi Tạo chiến dịch và khi Khởi chạy theo lịch từ bài điểm cao.`}
        actions={!notReady && <Button variant="primary" icon={Plus} onClick={() => setEdit({ ...structuredClone(BLANK), platform: pf })}>Tạo mẫu {pfLabel(pf)}</Button>} />
      <PlatformTabs value={pf} onChange={setPf} />
      {notReady ? <PlatformNotReady pf={pf as AdsPf} what="lưu mẫu quảng cáo" /> : <>
      {pf === "tiktok" && pst.loaded && !pst.of("tiktok").live && <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">Chưa kết nối TikTok Ads — mẫu lưu được trước, sẽ dùng khi có tài khoản TikTok kết nối.</p>}
      <Card>
        {!data ? <Loading /> : data.length === 0 ? <Empty>Chưa có mẫu {pfLabel(pf)} nào trong thư viện.</Empty> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.map((t) => {
              const d = t.definition ?? {};
              return (
                <div key={t.id} className="rounded-2xl border border-line p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><LayoutTemplate className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{t.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted"><PlatformIcon p={t.platform} size={14} />{OBJ[d.objective] ?? d.objective ?? "—"}</p>
                    </div>
                    <Badge tone="gray">{t.used} lần dùng</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted">Độ tuổi</dt><dd className="text-ink">{d.audience?.ageMin ?? "?"}–{d.audience?.ageMax ?? "?"}</dd>
                    <dt className="text-muted">Vị trí</dt><dd className="text-ink">{(d.audience?.locations ?? ["VN"]).join(", ")}</dd>
                    <dt className="text-muted">Giới tính</dt><dd className="text-ink">{d.audience?.genders?.length === 1 ? (d.audience.genders[0] === 1 ? "Nam" : "Nữ") : "Tất cả"}{d.advantageAudience !== false ? " · Advantage+" : ""}</dd>
                    <dt className="text-muted">Ngân sách gợi ý</dt><dd className="text-ink">{vndFull(d.budget?.amount)}</dd>
                    <dt className="text-muted">CPA mục tiêu</dt><dd className="text-ink">{d.targetCpa ? vndFull(d.targetCpa) : "—"}</dd>
                  </dl>
                  {d.audience?.interests?.length > 0 && <p className="mt-2 text-xs text-muted">Sở thích (ghi chú): {d.audience.interests.map((i: any) => (typeof i === "string" ? i : i.name)).join(", ")}</p>}
                  {d.objective === "sales" && <p className="mt-1 text-xs text-muted">Pixel {d.pixelId ?? "—"} · {(metaOpts?.conversionEvents ?? []).find((e: any) => e.value === d.conversionEvent)?.label ?? d.conversionEvent ?? "chưa chọn sự kiện"}</p>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted">tạo {ddmm(t.created_at)}</span>
                    <span className="flex gap-1"><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(structuredClone({ ...BLANK, ...t, definition: { ...BLANK.definition, ...d, audience: { ...BLANK.definition.audience, ...(d.audience ?? {}) }, budget: { ...BLANK.definition.budget, ...(d.budget ?? {}) } } }))}>Sửa</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(t)} aria-label="Xóa" /></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </>}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? "Sửa mẫu quảng cáo" : "Tạo mẫu quảng cáo"}
        footer={<><Button onClick={() => setEdit(null)}>Hủy</Button><Button variant="primary" loading={busy} onClick={save}>Lưu mẫu</Button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên mẫu"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="VD: Tin nhắn CEO 28–55" /></Field>
              <Field label="Nền tảng"><select className={inputCls} value={edit.platform} onChange={(e) => setEdit({ ...edit, platform: e.target.value })}><option value="meta">Facebook (Meta Ads)</option><option value="tiktok">TikTok</option></select></Field>
            </div>
            <Field label="Mục tiêu"><select className={inputCls} value={edit.definition.objective} onChange={(e) => setD({ objective: e.target.value })}>{Object.entries(OBJ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tuổi từ"><input type="number" min={13} max={65} className={inputCls} value={edit.definition.audience.ageMin} onChange={(e) => setAud({ ageMin: Number(e.target.value) })} /></Field>
              <Field label="Tuổi đến"><input type="number" min={13} max={65} className={inputCls} value={edit.definition.audience.ageMax} onChange={(e) => setAud({ ageMax: Number(e.target.value) })} /></Field>
              <Field label="Quốc gia (mã)" hint="VD: VN"><input className={inputCls} value={edit.definition.audience.locations.join(",")} onChange={(e) => setAud({ locations: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) })} /></Field>
            </div>
            {edit.definition.objective === "sales" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Pixel" hint={liveAcc ? (pixels && !pixels.length ? "Tài khoản chưa có pixel" : undefined) : "Chưa có tài khoản Facebook thật — nhập ID pixel"}>
                  {liveAcc && pixels?.length
                    ? <select className={inputCls} value={edit.definition.pixelId ?? ""} onChange={(e) => setD({ pixelId: e.target.value || null })}><option value="">Chọn pixel…</option>{pixels.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.lastFired ? "" : " (chưa nhận dữ liệu)"}</option>)}</select>
                    : <input className={inputCls} value={edit.definition.pixelId ?? ""} onChange={(e) => setD({ pixelId: e.target.value.trim() || null })} placeholder="VD: 123456789012345" />}
                </Field>
                <Field label="Sự kiện chuyển đổi"><select className={inputCls} value={edit.definition.conversionEvent ?? ""} onChange={(e) => setD({ conversionEvent: e.target.value || null })}><option value="">Chọn sự kiện…</option>{(metaOpts?.conversionEvents ?? []).map((ev: any) => <option key={ev.value} value={ev.value}>{ev.label}</option>)}</select></Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Giới tính"><select className={inputCls} value={edit.definition.audience.genders?.length === 1 ? String(edit.definition.audience.genders[0]) : ""} onChange={(e) => setAud({ genders: e.target.value ? [Number(e.target.value)] : [] })}><option value="">Tất cả</option><option value="1">Nam</option><option value="2">Nữ</option></select></Field>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Mở rộng đối tượng (Advantage+)</b><span className="block text-xs text-muted">Bật: tuổi/giới tính thành gợi ý, Facebook tự tìm thêm người hợp</span></span><Toggle checked={edit.definition.advantageAudience !== false} onChange={(v) => setD({ advantageAudience: v })} /></label>
            </div>
            <Field label="Sở thích (ghi chú, cách nhau dấu phẩy)" hint="Lưu làm ghi chú cho Ads Agent, không gửi lên Facebook.">
              <input className={inputCls} value={Array.isArray(edit.definition.audience.interests) ? edit.definition.audience.interests.map((i: any) => (typeof i === "string" ? i : i.name)).join(", ") : edit.definition.audience.interests} onChange={(e) => setAud({ interests: e.target.value })} placeholder="Quản trị doanh nghiệp, Khởi nghiệp, CEO" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ngân sách gợi ý/ngày (VNĐ)"><input type="number" step={100000} className={inputCls} value={edit.definition.budget.amount} onChange={(e) => setD({ budget: { ...edit.definition.budget, amount: Number(e.target.value) } })} /></Field>
              <Field label="CPA mục tiêu (VNĐ, tuỳ chọn)" hint="Dùng cho rule so với CPA mục tiêu"><input type="number" step={10000} className={inputCls} value={edit.definition.targetCpa ?? ""} onChange={(e) => setD({ targetCpa: e.target.value ? Number(e.target.value) : null })} /></Field>
            </div>
            <Field label="Quy tắc đặt tên"><input className={inputCls} value={edit.definition.naming} onChange={(e) => setD({ naming: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Xóa mẫu quảng cáo?"
        footer={<><Button onClick={() => setDel(null)}>Hủy</Button><Button variant="danger" icon={Trash2} onClick={async () => { try { await api.del(`ad-templates/${del.id}`); toast("Đã xóa mẫu"); setDel(null); reload(); } catch (e: any) { toast(e.message, "err"); } }}>Xóa</Button></>}>
        {del && <p className="text-sm text-muted">Xóa mẫu <b className="text-ink">{del.name}</b>? Quảng cáo đã tạo từ mẫu không bị ảnh hưởng.</p>}
      </Modal>
    </div>
  );
}
