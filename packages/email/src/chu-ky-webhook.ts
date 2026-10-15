// Chép từ auto-funnel core/chu-ky-webhook.ts — chữ ký webhook Resend (chuẩn svix). THUẦN, test được.
import { createHmac, timingSafeEqual } from "node:crypto";

const bangNhau = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const LECH_GIO_SVIX_GIAY = 300;

/**
 * Resend (chuẩn svix): chữ ký = HMAC-SHA256(secret đã base64-decode, `${id}.${timestamp}.${thân RAW}`)
 * mã hoá base64; header `svix-signature` chứa nhiều "v1,<chữ ký>" cách nhau bằng dấu cách.
 * Timestamp lệch quá 5 phút bị từ chối để chặn phát lại (replay).
 */
export function kiemSvix(v: {
  thanRaw: string; id: string | null | undefined; timestamp: string | null | undefined;
  header: string | null | undefined; secret: string; bayGioMs?: number;
}): { dat: boolean; lyDo?: string } {
  if (!v.id || !v.timestamp || !v.header) return { dat: false, lyDo: "Thiếu header svix-id / svix-timestamp / svix-signature." };
  const ts = Number(v.timestamp);
  if (!Number.isFinite(ts)) return { dat: false, lyDo: "svix-timestamp không phải số." };
  const lech = Math.abs((v.bayGioMs ?? Date.now()) / 1000 - ts);
  if (lech > LECH_GIO_SVIX_GIAY) return { dat: false, lyDo: `Timestamp lệch ${Math.round(lech)} giây — quá hạn chống phát lại.` };
  const khoa = Buffer.from(v.secret.replace(/^whsec_/, ""), "base64");
  const dung = createHmac("sha256", khoa).update(`${v.id}.${ts}.${v.thanRaw}`).digest("base64");
  const khop = v.header.split(/\s+/).some((p) => {
    const [phien, chuKy] = p.split(",");
    return phien === "v1" && !!chuKy && bangNhau(chuKy, dung);
  });
  return khop ? { dat: true } : { dat: false, lyDo: "Không chữ ký v1 nào khớp." };
}
