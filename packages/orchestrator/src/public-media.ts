import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { byId, q, type Row } from "@dotaka/db";
import { isValidEncryptionKey, sha256 } from "@dotaka/shared";
import { mediaBase } from "./tracking.ts";

/**
 * Link media công khai ký sẵn cho Instagram (chỉ nhận image_url / video_url công khai, không nhận tệp tải lên).
 * `${PUBLIC_BASE_URL}/m/<token>`: token = base64url("<assetId>.<hết hạn>") + "." + HMAC-SHA256. Chỉ phục vụ tệp của nội dung ĐÃ DUYỆT
 * (approved / scheduled / published) — tệp chưa duyệt không bao giờ lộ ra, kể cả khi token hợp lệ. Hết hạn sau 3 giờ.
 * KHÔNG mở /v1/media/:id (route đó không kiểm tra gì) ra internet.
 */
const TTL_MS = 3 * 3600_000;
const bootSecret = randomBytes(32).toString("hex");
const secret = () => sha256(`taki-media:${isValidEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY) ? process.env.TOKEN_ENCRYPTION_KEY : bootSecret}`);
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 32); // 192 bit
const SERVABLE = ["approved", "scheduled", "published"];

export function signMediaToken(assetId: string, ttlMs = TTL_MS, now = Date.now()): string {
  const payload = Buffer.from(`${assetId}.${now + ttlMs}`).toString("base64url");
  return `${payload}.${mac(payload)}`;
}
export function verifyMediaToken(token: string, now = Date.now()): { assetId: string } | null {
  const [payload, sig, ...rest] = String(token ?? "").split(".");
  if (!payload || !sig || rest.length) return null;
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [assetId, exp] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  if (!assetId || !(Number(exp) > now)) return null;
  return { assetId };
}
/** Tệp của tài sản này được phép phục vụ công khai không (thuộc nội dung đã duyệt, tệp còn trên máy). */
export function servableAsset(assetId: string): { path: string; mime: string; size: number | null } | null {
  const asset = byId<Row>("creative_asset", assetId);
  if (!asset?.path || !existsSync(asset.path)) return null;
  const ci = q.get<Row>("SELECT status FROM content_item WHERE asset_id = ? ORDER BY updated_at DESC LIMIT 1", assetId);
  if (!ci || !SERVABLE.includes(ci.status)) return null;
  return { path: asset.path, mime: asset.mime ?? "application/octet-stream", size: asset.size ?? null };
}
/** Link công khai (để Instagram tải media) hoặc undefined khi chưa có địa chỉ công khai + cổng công khai đang chạy. */
export function publicMediaUrl(assetId: string): string | undefined {
  const base = mediaBase();
  return base ? `${base}/m/${signMediaToken(assetId)}` : undefined;
}
