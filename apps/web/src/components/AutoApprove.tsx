import { useState } from "react";
import { BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Modal, Toggle, cx, useToast } from "./ui";

/**
 * Tự động phê duyệt: công tắc Sếp bật tay + ngưỡng điểm. Bài / kịch bản / bài SEO / video MỚI vào hộp Duyệt mà review "Đạt" và
 * điểm ≥ ngưỡng thì được duyệt luôn và đi xuống phần Đăng bài. Mục đang chờ từ trước chỉ duyệt khi bấm "Duyệt ngay".
 * Máy chủ: /v1/auto-approve (GET, PUT), /v1/auto-approve/run (POST).
 */
type View = {
  enabled: boolean; minScore: number; min: number; pendingEligible: number; pendingReady: number; publishKilled: boolean;
  recent: { at: string; title: string; score: number | null }[];
};

export function AutoApprove({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useApi<View>("auto-approve", ["approval."]);
  const toast = useToast();
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "score" | "run">(null);
  const [confirm, setConfirm] = useState<null | "on" | "run">(null);
  if (!data) return null;
  const cur = score ?? data.minScore; // chưa chỉnh thì theo giá trị đã lưu trên máy chủ
  const dirty = cur !== data.minScore;

  const save = async (patch: { enabled?: boolean; minScore?: number }, key: "toggle" | "score", ok: string) => {
    setBusy(key);
    try { await api.put("auto-approve", patch); setScore(null); toast(ok); reload(); onChanged(); } catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(null); }
  };
  const runNow = async () => {
    setBusy("run");
    try {
      const r = await api.post<{ approved: number; skipped: { reason: string }[] }>("auto-approve/run");
      toast(r.approved ? `Đã duyệt ${r.approved} mục — đang đi xuống phần Đăng bài` : "Không có mục nào đạt điều kiện để duyệt", r.approved ? "ok" : "info");
      setConfirm(null); reload(); onChanged();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };

  return (
    <Card className="mb-6" bodyClass="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", data.enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-soft text-muted")}><Zap className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            Tự động phê duyệt
            <Badge tone={data.enabled ? "green" : "gray"}>{data.enabled ? `ĐANG BẬT · từ ${data.minScore} điểm` : "Đang tắt"}</Badge>
          </p>
          <p className="text-xs text-muted">Bật thì bài, kịch bản, bài SEO và video mới đạt ngưỡng điểm sẽ được duyệt luôn và đi xuống phần Đăng bài, không chờ Sếp.</p>
        </div>
        <Toggle checked={data.enabled} disabled={busy !== null} label="Bật / tắt tự động phê duyệt"
          onChange={(on) => (on ? setConfirm("on") : void save({ enabled: false }, "toggle", "Đã tắt tự động phê duyệt — mọi mục lại chờ Sếp duyệt"))} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-soft p-3">
        <label htmlFor="auto-approve-score" className="text-sm font-medium text-ink">Tự duyệt khi điểm review từ</label>
        <input id="auto-approve-score" type="range" min={data.min} max={100} step={1} value={cur} onChange={(e) => setScore(Number(e.target.value))} className="h-2 min-w-32 flex-1 accent-blue-600" />
        <input type="number" min={data.min} max={100} value={cur} aria-label="Điểm tối thiểu để tự duyệt" onChange={(e) => setScore(Math.max(data.min, Math.min(100, Math.round(Number(e.target.value) || data.min))))}
          className="h-9 w-20 rounded-xl border border-line bg-card px-2 text-center text-sm font-semibold text-ink" />
        <span className="text-sm text-muted">/ 100 trở lên</span>
        <Button size="sm" variant="primary" loading={busy === "score"} disabled={!dirty || busy !== null} onClick={() => save({ minScore: cur }, "score", `Đã đặt ngưỡng tự duyệt: từ ${cur} điểm`)}>Lưu ngưỡng</Button>
      </div>
      <p className="text-xs text-muted">Dưới {data.min} điểm review không bao giờ "Đạt" nên không có ngưỡng thấp hơn. Chỉ duyệt khi review "Đạt", không có lỗi nghiêm trọng, bài SEO đủ ảnh, video qua kiểm tra kỹ thuật.</p>

      {data.publishKilled && <p className="rounded-xl bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">Kill switch đăng bài đang BẬT nên hệ thống tạm không tự duyệt.</p>}

      {data.enabled && data.pendingEligible > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
          <p className="min-w-0 flex-1 basis-60 text-ink">
            Đang có <b>{data.pendingEligible}</b> mục nội dung / video chờ từ trước, trong đó <b className={data.pendingReady ? "text-emerald-600" : ""}>{data.pendingReady}</b> mục đạt ngưỡng từ {data.minScore} điểm.
            <span className="block text-xs text-muted">Bật công tắc chỉ áp cho mục MỚI; mục chờ từ trước chỉ được duyệt khi Sếp bấm nút này.</span>
          </p>
          <Button size="sm" variant="success" icon={BadgeCheck} disabled={!data.pendingReady || busy !== null} onClick={() => setConfirm("run")}>Duyệt ngay {data.pendingReady} mục</Button>
        </div>
      )}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Áp dụng cho gì · không bao giờ tự duyệt gì · các mục vừa tự duyệt</summary>
        <div className="mt-2 space-y-2">
          <p><b className="text-ink">Tự duyệt được:</b> bài viết mạng xã hội, kịch bản video, bài SEO (khâu Content / Video / SEO) và video Flow thành phẩm. Bài đi xuống phần Đăng bài theo lịch &amp; giờ yên lặng đã cài; video được đăng nháp lên kênh. Mục của Lái tự động cũng được tính.</p>
          <p className="flex items-start gap-1.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span><b className="text-ink">Luôn do Sếp duyệt:</b> quảng cáo và thay đổi ngân sách, tin nhắn gửi khách (follow-up Zalo, chăm khách từ bình luận), đơn hàng, đề xuất học, kế hoạch / chiến lược.</span></p>
          {data.recent.length > 0 ? (
            <ul className="space-y-1">{data.recent.map((r, i) => <li key={i} className="flex items-center gap-2"><Badge tone="green">{r.score != null ? Math.round(r.score) : "—"}đ</Badge><span className="min-w-0 flex-1 truncate text-ink">{r.title}</span><span className="shrink-0">{timeAgo(r.at)}</span></li>)}</ul>
          ) : <p>Chưa có mục nào được tự duyệt.</p>}
        </div>
      </details>

      <Modal open={confirm === "on"} onClose={() => setConfirm(null)} title="Bật tự động phê duyệt?"
        footer={<><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="primary" icon={Zap} loading={busy === "toggle"} onClick={async () => { await save({ enabled: true, minScore: cur }, "toggle", `Đã bật tự động phê duyệt từ ${cur} điểm`); setConfirm(null); }}>Bật, tự duyệt từ {cur} điểm</Button></>}>
        <div className="space-y-2 text-sm text-ink">
          <p>Từ bây giờ, <b>bài viết, kịch bản, bài SEO và video MỚI</b> có review "Đạt" và <b>từ {cur} điểm trở lên</b> sẽ được duyệt luôn: bài đi xuống phần Đăng bài và có thể lên kênh mà Sếp không xem trước.</p>
          <p className="text-muted">Mục đang chờ từ trước không bị đụng tới. Quảng cáo, ngân sách, tin gửi khách và đơn hàng vẫn luôn do Sếp duyệt. Tắt bất cứ lúc nào bằng công tắc này.</p>
        </div>
      </Modal>
      <Modal open={confirm === "run"} onClose={() => setConfirm(null)} title={`Duyệt ngay ${data.pendingReady} mục đang chờ?`}
        footer={<><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="success" icon={BadgeCheck} loading={busy === "run"} onClick={runNow}>Duyệt {data.pendingReady} mục</Button></>}>
        <p className="text-sm text-ink">{data.pendingReady} mục nội dung / video đang chờ đã đạt ngưỡng từ {data.minScore} điểm sẽ được duyệt và đi xuống phần Đăng bài (đăng theo lịch, giới hạn số bài mỗi ngày mỗi kênh đã cài).</p>
      </Modal>
    </Card>
  );
}
