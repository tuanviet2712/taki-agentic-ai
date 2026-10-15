// Token hủy nhận (link trong footer + header List-Unsubscribe): base64url {b: biz, c: contact} + HMAC rút gọn.
// Chép cách làm của auto-funnel (taoTokenHuy/docTokenHuy); khoá HMAC do bên gọi truyền vào (dẫn xuất từ TOKEN_ENCRYPTION_KEY).
import { createHmac, timingSafeEqual } from "node:crypto";

const sig = (b: string, secret: string) => createHmac("sha256", secret).update(b).digest("base64url").slice(0, 22);

export function makeUnsubToken(bizId: string, contactId: string, secret: string): string {
  const b = Buffer.from(JSON.stringify({ b: bizId, c: contactId })).toString("base64url");
  return `${b}.${sig(b, secret)}`;
}

export function readUnsubToken(token: string, secret: string): { bizId: string; contactId: string } | null {
  const [b, s] = String(token ?? "").split(".");
  if (!b || !s) return null;
  const want = sig(b, secret);
  if (s.length !== want.length || !timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try {
    const { b: bizId, c: contactId } = JSON.parse(Buffer.from(b, "base64url").toString());
    return typeof bizId === "string" && typeof contactId === "string" ? { bizId, contactId } : null;
  } catch { return null; }
}
