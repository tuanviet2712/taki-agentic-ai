import { promises as dns } from "node:dns";
import { audit, byId, update, type Row } from "@dotaka/db";
import { live } from "@dotaka/connectors";
import {
  chuanDomainGui, danhGiaDkim, danhGiaDmarc, danhGiaSpf, dmarcMacDinh, sangCf, soSanhDns, tenSpfResend, tongKetXacThuc, type ViecDns,
} from "@dotaka/email";
import { AppError, encryptSecret, nowIso } from "@dotaka/shared";
import { credsOf } from "../connections.ts";
import { publicBaseUrl } from "../tracking.ts";
import { emailConnection } from "./settings.ts";

/**
 * Domain gửi (chép auto-funnel services/ket-noi-email.ts + kiemDnsDomain): một nút dựng trọn đường gửi thật
 * — thêm domain trên Resend → đẩy bản ghi sang Cloudflare (thêm / sửa / giữ, KHÔNG xoá gì) + DMARC → xin xác minh → tạo webhook
 * Resend → lưu khoá ký. Khác bản gốc: khoá lưu MÃ HOÁ trong kết nối (không ghi .env), và mọi bước báo kết quả rõ ràng.
 */
export type Step = { name: string; ok: boolean; detail: string };

/** Đọc + chấm SPF / DKIM / DMARC thật của domain gửi (Resend đặt SPF ở send.<domain>). */
export async function checkDns(domain: string) {
  const txt = async (host: string) => { try { return (await dns.resolveTxt(host)).map((r) => r.join("")); } catch { return [] as string[]; } };
  const [spfSend, spfRoot, dmarc, dkim] = await Promise.all([txt(tenSpfResend(domain)), txt(domain), txt(`_dmarc.${domain}`), txt(`resend._domainkey.${domain}`)]);
  const spfTxt = spfSend.some((t) => t.toLowerCase().startsWith("v=spf1")) ? spfSend : spfRoot;
  const spf = danhGiaSpf(spfTxt, "resend"), dk = danhGiaDkim(dkim, "resend"), dm = danhGiaDmarc(dmarc);
  const sum = tongKetXacThuc({ spf, dkim: dk, dmarc: dm });
  return { spf, dkim: dk, dmarc: dm, ok: sum.dat, fixes: sum.canSua, at: nowIso() };
}

function mustConn(bizId: string): Row {
  const c = emailConnection(bizId);
  if (!c || c.mode !== "live") throw new AppError("EMAIL_NOT_CONNECTED", "Chưa có kết nối Email (Resend) thật — Kết nối → Email (Resend)", 400);
  return c;
}
function saveConn(c: Row, cfgPatch: Row, credPatch?: Record<string, string>) {
  const fresh = byId<Row>("connection", c.id)!;
  update("connection", c.id, { config: { ...(fresh.config ?? {}), ...cfgPatch }, ...(credPatch ? { token_ciphertext: encryptSecret(JSON.stringify({ ...credsOf(fresh), ...credPatch })) } : {}) });
}

/** Kiểm lại: trạng thái domain trên Resend + DNS thật. */
export async function recheckDomain(bizId: string, actor: string) {
  const c = mustConn(bizId);
  const cr = credsOf(c);
  const from = String(c.config?.from_address ?? "");
  const r = await live.resendTest({ api_key: cr.api_key }, from);
  if (r.domainId && r.status !== "verified") { await live.resendVerifyDomain(cr.api_key, r.domainId).catch(() => undefined); }
  const d = r.domainId ? await live.resendDomain(cr.api_key, r.domainId).catch(() => null) : null;
  const check = await checkDns(r.domain);
  saveConn(c, { domain: r.domain, domain_id: r.domainId, domain_status: d?.status ?? r.status, dns: check });
  audit(bizId, actor, "email.domain_checked", { type: "connection", id: c.id }, { status: d?.status ?? r.status, dns: check.ok });
  return { domain: r.domain, status: d?.status ?? r.status, records: d?.records ?? [], dns: check };
}

/**
 * Thiết lập tự động. Cần: khoá Resend Full access; Cloudflare token (Edit zone DNS) nếu muốn tự thêm DNS;
 * PUBLIC_BASE_URL https để tạo webhook. Thiếu Cloudflare → vẫn thêm domain + trả bản ghi để thêm tay.
 */
export async function setupDomain(bizId: string, actor: string, opts: { cloudflareToken?: string } = {}): Promise<{ ok: boolean; steps: Step[]; records: Row[] }> {
  const c = mustConn(bizId);
  const cr = credsOf(c);
  const steps: Step[] = [];
  const from = String(c.config?.from_address ?? "");
  const d = chuanDomainGui(from.split("@")[1] ?? "");
  if (!d.ok) return { ok: false, steps: [{ name: "Domain gửi", ok: false, detail: d.loi }], records: [] };
  if (opts.cloudflareToken?.trim()) { saveConn(c, {}, { cloudflare_token: opts.cloudflareToken.trim() }); cr.cloudflare_token = opts.cloudflareToken.trim(); }

  // 1. Domain trên Resend
  let rd = (await live.resendDomains(cr.api_key)).find((x) => x.name.toLowerCase() === d.domain) ?? null;
  if (!rd) { rd = await live.resendCreateDomain(cr.api_key, d.domain); steps.push({ name: "Thêm domain trên Resend", ok: true, detail: `đã thêm ${d.domain}` }); }
  else steps.push({ name: "Thêm domain trên Resend", ok: true, detail: `${d.domain} đã có (${rd.status})` });
  const full = await live.resendDomain(cr.api_key, rd.id);
  const records = (full.records ?? []) as Row[];

  // 2. DNS → Cloudflare (nếu có token)
  if (cr.cloudflare_token) {
    try {
      const zoneId = await live.cloudflareZoneId(cr.cloudflare_token, d.zone);
      const jobs: ViecDns[] = [];
      for (const r of full.records ?? []) {
        const want = sangCf(r, d.domain, d.zone);
        jobs.push(soSanhDns(want, await live.cloudflareRecords(cr.cloudflare_token, zoneId, want.name)));
      }
      const dm = dmarcMacDinh(d.domain, d.zone);
      const hasDmarc = (await live.cloudflareRecords(cr.cloudflare_token, zoneId, dm.name, "TXT")).some((x) => /v=dmarc1/i.test(x.content));
      if (!hasDmarc) jobs.push({ loai: "them", banGhi: dm, ghiChu: "thêm DMARC" });
      const errs: string[] = [];
      for (const j of jobs) {
        if (j.loai === "giu") continue;
        const e = await live.cloudflareUpsertRecord(cr.cloudflare_token, zoneId, j.banGhi, j.loai === "sua" ? j.cuId : undefined);
        if (e) errs.push(`${j.banGhi.type} ${j.banGhi.name}: ${e}`);
      }
      steps.push(errs.length
        ? { name: "Đẩy DNS sang Cloudflare", ok: false, detail: `${errs.join(" | ")}. Token cần quyền Zone · DNS · Edit.` }
        : { name: "Đẩy DNS sang Cloudflare", ok: true, detail: jobs.map((j) => `${j.banGhi.type} ${j.banGhi.name} — ${j.ghiChu}`).join(" · ") });
    } catch (e) {
      steps.push({ name: "Đẩy DNS sang Cloudflare", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  } else {
    steps.push({ name: "Bản ghi DNS", ok: false, detail: "Chưa có Cloudflare token — thêm tay các bản ghi bên dưới vào nơi quản lý DNS, rồi bấm «Kiểm lại»." });
  }

  // 3. Xác minh (chờ ngắn; Resend xác minh tiếp theo lịch của nó)
  await live.resendVerifyDomain(cr.api_key, rd.id).catch(() => undefined);
  let status = full.status;
  for (let i = 0; i < 6 && status !== "verified" && cr.cloudflare_token; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    status = (await live.resendDomain(cr.api_key, rd.id).catch(() => full)).status;
  }
  steps.push({ name: "Resend xác minh domain", ok: status === "verified", detail: status === "verified" ? "đã xác minh — gửi thư thật được" : `đang «${status}». DNS mới thường mất vài phút đến 1 giờ — bấm «Kiểm lại» sau.` });

  // 4. Webhook Resend → cổng công khai
  const base = publicBaseUrl();
  if (base) {
    const endpoint = `${base}/hooks/email/resend`;
    const exists = (await live.resendWebhooks(cr.api_key)).some((w) => w.endpoint === endpoint);
    if (exists && cr.webhook_secret) steps.push({ name: "Webhook Resend", ok: true, detail: `đã có → ${endpoint}` });
    else if (exists) steps.push({ name: "Webhook Resend", ok: false, detail: `Webhook ${endpoint} đã có nhưng chưa có khoá ký: Resend → Webhooks → mở webhook → chép Signing secret → Kết nối → Email (Resend) → dán vào ô Webhook signing secret.` });
    else {
      const w = await live.resendCreateWebhook(cr.api_key, endpoint, ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.opened", "email.clicked"]);
      if (w.signing_secret) { saveConn(c, {}, { webhook_secret: w.signing_secret }); steps.push({ name: "Webhook Resend", ok: true, detail: `đã tạo → ${endpoint}, khoá ký đã lưu (mã hoá)` }); }
      else steps.push({ name: "Webhook Resend", ok: false, detail: `Không tự tạo được (${w.error ?? "?"}). Tạo tay: Resend → Webhooks → ${endpoint}, chọn các sự kiện email.*, dán Signing secret vào kết nối.` });
    }
  } else steps.push({ name: "Webhook Resend", ok: false, detail: "Chưa có PUBLIC_BASE_URL (https) — bật cổng công khai rồi bấm Thiết lập lại." });

  // 5. Kiểm DNS thật + lưu
  const check = await checkDns(d.domain);
  steps.push({ name: "Kiểm SPF / DKIM / DMARC", ok: check.ok, detail: check.ok ? "SPF ✓ DKIM ✓ DMARC ✓" : check.fixes.join(" | ") });
  saveConn(c, { domain: d.domain, domain_id: rd.id, domain_status: status, dns: check });
  audit(bizId, actor, "email.domain_setup", { type: "connection", id: c.id }, { domain: d.domain, status, steps: steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.name}`) });
  return { ok: steps.every((s) => s.ok), steps, records };
}
