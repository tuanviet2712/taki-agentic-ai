import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bot, CheckCircle2, Rocket, ShieldCheck, Sparkles, Target } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, vndFull, type Tone } from "../lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Fold, Loading, Modal, MoneyInput, PageHeader, Toggle, cx, inputCls, useToast } from "./ui";

type Objective = "traffic" | "leads" | "sales";
type Plan = {
  objective: Objective; name: string; finalUrl: string; keywords: { text: string; match: "PHRASE" | "EXACT" | "BROAD" }[];
  headlines: string[]; descriptions: string[]; path1: string; path2: string; rationale: string; source: "ai" | "template"; model: string;
};
type Check = { ok: boolean; live: boolean; note?: string; error?: string; bidding?: string };

const BIDDING_LABEL: Record<string, string> = {
  maximize_clicks: "Tối đa lượt nhấp", maximize_conversions: "Tối đa chuyển đổi", maximize_conversion_value: "Tối đa giá trị chuyển đổi",
};
const ST: Record<string, { label: string; tone: Tone }> = { done: { label: "Đã tạo", tone: "green" }, failed: { label: "Lỗi", tone: "red" } };
const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const count = (s: string) => Array.from(s).length;
/** Từ khóa: `[chữ]` = khớp chính xác, còn lại = khớp cụm từ. */
const parseKeywords = (t: string): Plan["keywords"] => lines(t).map((l) => (/^\[.+\]$/.test(l) ? { text: l.slice(1, -1).trim(), match: "EXACT" as const } : { text: l.replace(/^"|"$/g, "").trim(), match: "PHRASE" as const } )).filter((k) => k.text);
const showKeywords = (ks: Plan["keywords"]) => ks.map((k) => (k.match === "EXACT" ? `[${k.text}]` : k.text)).join("\n");

/** Tạo chiến dịch Google (Search) theo mục tiêu: AI soạn từ DNA rồi tạo — hoặc Sếp chỉnh từng dòng trước khi tạo. */
export function QuickAdGoogle({ tabs }: { tabs: ReactNode }) {
  const toast = useToast();
  const { data: opts } = useApi<any>("automation-options", ["alert."]);
  const { data: g } = useApi<any>("ads/google/options");
  const { data: recent, reload } = useApi<any[]>("ads/google/recent", ["action."]);
  const accounts = (opts?.adAccounts ?? []).filter((a: any) => a.platform === "google_ads" && a.whitelisted);

  const [accountId, setAccountId] = useState("");
  const [objective, setObjective] = useState<Objective>("leads");
  const [productKey, setProductKey] = useState("");
  const [topic, setTopic] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [budget, setBudget] = useState<number | null>(300_000);
  const [startPaused, setStartPaused] = useState(true);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [name, setName] = useState("");
  const [kw, setKw] = useState("");
  const [heads, setHeads] = useState("");
  const [descs, setDescs] = useState("");
  const [path1, setPath1] = useState("");
  const [path2, setPath2] = useState("");

  const [planning, setPlanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [confirm, setConfirm] = useState<null | "auto" | "manual">(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any | null>(null);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  // Chọn sản phẩm → điền sẵn URL (link sản phẩm, không có thì website của DNA).
  useEffect(() => {
    if (!g) return;
    const p = g.products.find((x: any) => x.key === productKey);
    setUrl(p?.link || g.website || "");
  }, [productKey, g]);

  const obj = g?.objectives.find((o: any) => o.key === objective);
  const lim = g?.limits ?? { headline: 30, description: 90, path: 15 };
  const hList = useMemo(() => lines(heads), [heads]);
  const dList = useMemo(() => lines(descs), [descs]);
  const kList = useMemo(() => parseKeywords(kw), [kw]);
  const hBad = hList.some((h) => count(h) > lim.headline || h.includes("!"));
  const dBad = dList.some((d) => count(d) > lim.description);
  const contentOk = !!url.trim() && kList.length >= 1 && hList.length >= 3 && hList.length <= 15 && !hBad && dList.length >= 2 && dList.length <= 4 && !dBad;
  const acc = accounts.find((a: any) => a.id === accountId);
  const subject = productKey ? g?.products.find((p: any) => p.key === productKey)?.name : topic;
  const baseInput = { objective, productKey: productKey || undefined, url: url.trim() || undefined, topic: productKey ? undefined : topic.trim() || undefined, note: note.trim() || undefined };
  const needSubject = !productKey && !topic.trim() && !g?.brand;

  const apply = (p: Plan) => {
    setPlan(p); setName(p.name); setKw(showKeywords(p.keywords)); setHeads(p.headlines.join("\n")); setDescs(p.descriptions.join("\n")); setPath1(p.path1); setPath2(p.path2);
    if (p.finalUrl) setUrl(p.finalUrl);
    setCheck(null);
  };
  const draft = async () => {
    setPlanning(true);
    try { apply(await api.post<Plan>("ads/google/plan", baseInput)); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setPlanning(false); }
  };
  const body = () => ({
    adAccountId: accountId, objective, dailyBudget: budget, startPaused, name: name.trim() || undefined, finalUrl: url.trim(),
    keywords: kList, headlines: hList, descriptions: dList, path1: path1.trim() || undefined, path2: path2.trim() || undefined,
  });
  const runCheck = async () => {
    setChecking(true); setCheck(null);
    try { setCheck(await api.post<Check>("ads/google/check", body())); }
    catch (e: any) { setCheck({ ok: false, live: true, error: e.message }); }
    finally { setChecking(false); }
  };
  const done = (r: any, extra?: Plan) => {
    setLast({ ...r, plan: extra ?? plan });
    toast(`Đã tạo chiến dịch "${r.name}" ${r.status === "paused" ? "(đang tạm dừng — kiểm tra rồi bật)" : "(đang chạy)"}`);
    setConfirm(null); setPlan(null); setCheck(null); setKw(""); setHeads(""); setDescs(""); setName(""); setPath1(""); setPath2("");
    reload();
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (confirm === "auto") {
        const r = await api.post<any>("ads/google/auto", { ...baseInput, adAccountId: accountId, dailyBudget: budget, startPaused, name: name.trim() || undefined });
        done(r, r.plan);
      } else done(await api.post<any>("ads/google/campaign", body()));
    } catch (e: any) { toast(e.message, "err"); setConfirm(null); reload(); }
    finally { setBusy(false); }
  };

  if (opts && !accounts.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tạo chiến dịch · Google" subtitle="Chọn mục tiêu → hệ thống soạn từ khóa, tiêu đề, mô tả từ DNA rồi tạo chiến dịch Search." />
        {tabs}
        <Card>
          <div className="py-10 text-center">
            <Rocket className="mx-auto h-10 w-10 text-muted" />
            <p className="mt-3 font-medium text-ink">Cần kết nối Google Ads trước</p>
            <p className="mt-1 text-sm text-muted">Cần ít nhất 1 tài khoản Google Ads (không phải tài khoản quản lý MCC) nằm trong whitelist.</p>
            <Link to="/ads/integrations?p=google_ads" className="mt-4 inline-block"><Button variant="primary">Mở Trung tâm tích hợp</Button></Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tạo chiến dịch · Google" subtitle="Chọn mục tiêu → hệ thống tự soạn từ khóa, tiêu đề, mô tả từ DNA rồi tạo chiến dịch Search. Mặc định tạo ở trạng thái tạm dừng; có kiểm tra trước với Google, trần ngân sách và nhật ký." />
      {tabs}
      {!opts || !g ? <Loading /> : (
        <div className="grid gap-6 wide:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Card title="1. Mục tiêu & ngân sách" icon={Target}>
            <div className="space-y-4">
              <div role="radiogroup" aria-label="Mục tiêu chiến dịch" className="grid gap-2">
                {g.objectives.map((o: any) => (
                  <button key={o.key} type="button" role="radio" aria-checked={objective === o.key} onClick={() => { setObjective(o.key); setCheck(null); }}
                    className={cx("flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition", objective === o.key ? "border-blue-500 bg-blue-500/[0.06] ring-2 ring-blue-500/20" : "border-line hover:border-blue-300")}>
                    <span className="text-sm font-semibold text-ink">{o.label}</span>
                    <span className="text-xs text-muted">{o.hint}</span>
                  </button>
                ))}
              </div>
              <Field label="Tài khoản Google Ads"><select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.mode === "sandbox" ? " (demo)" : ""}</option>)}</select></Field>
              <Field label="Quảng cáo gì?" hint={'Lấy từ sản phẩm trong DNA; chọn "Khác" để tự nhập.'}>
                <select className={inputCls} value={productKey} onChange={(e) => setProductKey(e.target.value)}>
                  <option value="">{g.products.length ? "Khác — tự nhập tên" : "Tự nhập tên sản phẩm / dịch vụ"}</option>
                  {g.products.map((p: any) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </Field>
              {!productKey && <Field label="Tên sản phẩm / dịch vụ" hint={g.brand ? `Để trống = dùng thương hiệu "${g.brand}"` : undefined}><input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="VD: Khóa học AI cho chủ doanh nghiệp" /></Field>}
              <Field label="URL trang đích" required hint="Người bấm quảng cáo sẽ vào trang này."><input className={inputCls} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
              <Field label="Ngân sách mỗi ngày" hint="Google có mức tối thiểu theo tài khoản; thấp hơn sẽ báo lỗi rõ ràng."><MoneyInput value={budget} onChange={setBudget} /></Field>
              <Field label="Dặn thêm cho AI" optional><textarea className={cx(inputCls, "min-h-16")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: nhấn mạnh học thực hành, nhắm chủ doanh nghiệp tại Hà Nội" /></Field>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tạo ở trạng thái tạm dừng</b><span className="block text-xs text-muted">An toàn: Sếp xem lại trên Google Ads rồi bật</span></span><Toggle checked={startPaused} onChange={setStartPaused} /></label>
              <div className="grid gap-2">
                <Button variant="primary" icon={Bot} disabled={!accountId || !budget || !url.trim() || needSubject} onClick={() => setConfirm("auto")}>Tạo tự động theo mục tiêu</Button>
                <Button icon={Sparkles} loading={planning} disabled={needSubject} onClick={draft}>Chỉ soạn nội dung bằng AI để chỉnh</Button>
              </div>
              <p className="text-xs text-muted">Tự động = AI soạn từ DNA rồi tạo luôn ({obj ? obj.label : ""}). Muốn xem và sửa chữ trước khi tạo thì dùng nút soạn.</p>
            </div>
          </Card>

          <div className="space-y-6">
            {last && (
              <Alert tone="ok" icon={CheckCircle2} title={`Đã tạo chiến dịch "${last.name}"`} action={<Button size="sm" onClick={() => setLast(null)}>Đóng</Button>}>
                {last.account} · {last.status === "paused" ? "đang tạm dừng" : "đang chạy"} · giá thầu: {BIDDING_LABEL[last.bidding] ?? last.bidding}{last.mode === "sandbox" ? " · tài khoản demo (không tạo thật trên Google)" : ""}.
                {last.note && <span className="mt-1 block text-amber-700 dark:text-amber-300">{last.note}</span>}
                {last.plan && <span className="mt-1 block text-muted">AI đã soạn {last.plan.keywords.length} từ khóa, {last.plan.headlines.length} tiêu đề, {last.plan.descriptions.length} mô tả. {last.plan.rationale}</span>}
              </Alert>
            )}
            <Card title="2. Nội dung quảng cáo" icon={Sparkles} action={plan ? <Badge tone={plan.source === "ai" ? "violet" : "gray"}>{plan.source === "ai" ? "AI soạn" : "Mẫu chuẩn"}</Badge> : undefined}>
              {!plan && !kw && !heads ? (
                <Empty>Bấm "Chỉ soạn nội dung bằng AI để chỉnh" để xem trước từ khóa, tiêu đề, mô tả — hoặc dùng "Tạo tự động" để làm một lệnh.</Empty>
              ) : (
                <div className="space-y-4">
                  {plan?.source === "template" && <Alert tone="info">Chưa nối model AI nên hệ thống dùng mẫu chuẩn theo mục tiêu (vẫn chỉ dùng dữ kiện trong DNA). Nối AI ở Kết nối → AI để chữ hay hơn.</Alert>}
                  {plan?.rationale && plan.source === "ai" && <p className="rounded-xl bg-soft p-3 text-sm text-muted">{plan.rationale}</p>}
                  <Field label="Tên chiến dịch" hint="Google không cho trùng tên với chiến dịch đã có."><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
                  <Field label={`Từ khóa (${kList.length})`} hint="Mỗi dòng 1 từ khóa. Chữ thường = khớp cụm từ; [trong ngoặc vuông] = khớp chính xác.">
                    <textarea className={cx(inputCls, "min-h-32 font-mono text-sm")} value={kw} onChange={(e) => { setKw(e.target.value); setCheck(null); }} />
                  </Field>
                  <Field label={`Tiêu đề (${hList.length}/15, cần ≥ 3)`} error={hBad ? `Có tiêu đề dài quá ${lim.headline} ký tự hoặc có dấu "!"` : undefined} hint={`Mỗi dòng 1 tiêu đề, tối đa ${lim.headline} ký tự, không dấu "!".`}>
                    <textarea className={cx(inputCls, "min-h-32")} value={heads} onChange={(e) => { setHeads(e.target.value); setCheck(null); }} />
                  </Field>
                  <Counter items={hList} max={lim.headline} />
                  <Field label={`Mô tả (${dList.length}/4, cần ≥ 2)`} error={dBad ? `Có mô tả dài quá ${lim.description} ký tự` : undefined} hint={`Mỗi dòng 1 mô tả, tối đa ${lim.description} ký tự.`}>
                    <textarea className={cx(inputCls, "min-h-24")} value={descs} onChange={(e) => { setDescs(e.target.value); setCheck(null); }} />
                  </Field>
                  <Counter items={dList} max={lim.description} />
                  <Fold flat title="Đường dẫn hiển thị" summary={path1 ? `${path1}${path2 ? `/${path2}` : ""}` : "Không dùng"}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Đường dẫn 1" optional><input className={inputCls} maxLength={lim.path} value={path1} onChange={(e) => setPath1(e.target.value)} /></Field>
                      <Field label="Đường dẫn 2" optional><input className={inputCls} maxLength={lim.path} value={path2} onChange={(e) => setPath2(e.target.value)} disabled={!path1} /></Field>
                    </div>
                  </Fold>
                  {checking && <p className="rounded-xl bg-soft p-3 text-xs text-muted">Đang nhờ Google kiểm tra toàn bộ chiến dịch (không tạo gì)…</p>}
                  {check && (check.ok
                    ? <Alert tone="ok" icon={ShieldCheck}>{check.note}{check.bidding && <span className="block text-xs text-muted">Giá thầu: {BIDDING_LABEL[check.bidding] ?? check.bidding}</span>}</Alert>
                    : <Alert tone="danger" title="Google từ chối / nội dung chưa hợp lệ" action={<Button size="sm" onClick={runCheck}>Kiểm tra lại</Button>}><span className="whitespace-pre-line">{check.error}</span></Alert>)}
                  <div className="flex flex-wrap gap-2">
                    <Button icon={ShieldCheck} loading={checking} disabled={!contentOk || !accountId || !budget} onClick={runCheck}>Kiểm tra trước với Google</Button>
                    <Button variant="primary" icon={Rocket} disabled={!contentOk || !accountId || !budget} onClick={() => setConfirm("manual")}>Tạo chiến dịch</Button>
                  </div>
                  {!contentOk && <p className="text-xs text-amber-700 dark:text-amber-300">Cần: URL trang đích, ≥ 1 từ khóa, 3–15 tiêu đề, 2–4 mô tả, đúng giới hạn ký tự.</p>}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <Card title="Chiến dịch Google tạo gần đây">
        {!recent ? <Loading /> : recent.length === 0 ? <Empty>Chưa có.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Thời gian", "Chiến dịch", "Mục tiêu", "Ngân sách/ngày", "Trạng thái"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted">{ddmm(r.created_at)} {hhmm(r.created_at)}</td>
                    <td className="max-w-[300px] px-2 py-2.5"><p className="truncate text-ink">{r.params?.name}</p><p className="truncate text-xs text-muted">{r.params?.account}{r.params?.mode === "sandbox" ? " · demo" : ""}</p></td>
                    <td className="px-2 py-2.5 text-xs text-muted">{g?.objectives.find((o: any) => o.key === r.params?.objective)?.label ?? r.params?.objective}<span className="block">{BIDDING_LABEL[r.params?.bidding] ?? ""}</span></td>
                    <td className="px-2 py-2.5 tabular-nums">{vndFull(r.params?.dailyBudget)}</td>
                    <td className="px-2 py-2.5"><Badge tone={ST[r.status]?.tone ?? "gray"}>{ST[r.status]?.label ?? r.status}</Badge>{r.status === "done" && <span className="ml-1 text-xs text-muted">{r.ad_status === "active" ? "· đang chạy" : "· đang tạm dừng"}</span>}{r.status === "failed" && r.reason && <p className="mt-1 max-w-[320px] whitespace-pre-line text-xs text-rose-500">{r.reason}</p>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)} title={confirm === "auto" ? "Tạo tự động theo mục tiêu" : "Xác nhận tạo chiến dịch"}
        footer={<><Button disabled={busy} onClick={() => setConfirm(null)}>Hủy</Button><Button variant="primary" icon={Rocket} loading={busy} onClick={submit}>{confirm === "auto" ? "AI soạn và tạo" : "Xác nhận tạo"}</Button></>}>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">Tài khoản</dt><dd className="text-ink">{acc?.name}{acc?.mode === "sandbox" && <Badge tone="amber" className="ml-1">demo</Badge>}</dd>
            <dt className="text-muted">Mục tiêu</dt><dd className="text-ink">{obj?.label}</dd>
            {confirm === "auto"
              ? <><dt className="text-muted">Quảng cáo</dt><dd className="text-ink">{subject || g?.brand || "(theo website)"}</dd></>
              : <><dt className="text-muted">Nội dung</dt><dd className="text-ink">{kList.length} từ khóa · {hList.length} tiêu đề · {dList.length} mô tả</dd></>}
            <dt className="text-muted">Trang đích</dt><dd className="break-all text-ink">{url}</dd>
            <dt className="text-muted">Ngân sách/ngày</dt><dd className="font-semibold text-ink">{vndFull(budget)}</dd>
            <dt className="text-muted">Trạng thái khi tạo</dt><dd className="text-ink">{startPaused ? "Tạm dừng" : "Chạy ngay"}</dd>
          </dl>
          {confirm === "auto" && <p className="rounded-xl bg-soft p-3 text-xs text-muted">AI sẽ soạn từ khóa, tiêu đề, mô tả từ DNA rồi tạo chiến dịch. Có thể mất tới ~1 phút nếu dùng Claude; đừng đóng trang.</p>}
          {acc?.mode === "live" && !startPaused && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">Chiến dịch sẽ chạy và tiêu tiền thật ngay khi Google duyệt quảng cáo.</p>}
        </div>
      </Modal>
    </div>
  );
}

/** Đếm ký tự từng dòng: dòng quá giới hạn đỏ lên. */
function Counter({ items, max }: { items: string[]; max: number }) {
  if (!items.length) return null;
  return (
    <ul className="-mt-2 flex flex-wrap gap-1.5 text-[11px]">
      {items.map((t, i) => {
        const n = count(t);
        return <li key={i} className={cx("rounded-md px-1.5 py-0.5 tabular-nums", n > max ? "bg-rose-500/15 text-rose-600" : "bg-soft text-muted")} title={t}>{i + 1}: {n}/{max}</li>;
      })}
    </ul>
  );
}
