import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** UUID v7: time-ordered ids so inserts stay sequential (spec §4). */
export function uuidv7(): string {
  const ts = BigInt(Date.now());
  const bytes = randomBytes(16);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic pseudo-random in [0,1) from a string seed (sandbox data only). */
export function seeded(seed: string): number {
  const h = createHash("md5").update(seed).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

// ---------- Money: integers in the currency's smallest unit (VND has no minor unit) ----------
export function formatVnd(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${(amount / 1e9).toFixed(2).replace(/\.?0+$/, "")} tỷ đ`;
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1).replace(/\.0$/, "")} triệu đ`;
  return `${Math.round(amount).toLocaleString("vi-VN")} đ`;
}

// ---------- Logger with secret redaction (spec §15: tokens never reach logs) ----------
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /\b(sk|pk|mcp|ts)_(live|test)?_?[A-Za-z0-9]{12,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._-]{12,}/g,
  /("?(api[_-]?key|token|secret|password)"?\s*[:=]\s*"?)[^"\s,}]+/gi,
];
export function redact(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, (_m, g1) => (typeof g1 === "string" && g1.length < 40 ? `${g1}***` : "***"));
  return out;
}
type Level = "debug" | "info" | "warn" | "error";
export const logger = {
  log(level: Level, msg: string, data?: Record<string, unknown>) {
    const line = JSON.stringify({ t: nowIso(), level, msg, ...data });
    const safe = redact(line);
    if (level === "error") console.error(safe);
    else if (level !== "debug" || process.env.LOG_LEVEL === "debug") console.log(safe);
  },
  debug: (m: string, d?: Record<string, unknown>) => logger.log("debug", m, d),
  info: (m: string, d?: Record<string, unknown>) => logger.log("info", m, d),
  warn: (m: string, d?: Record<string, unknown>) => logger.log("warn", m, d),
  error: (m: string, d?: Record<string, unknown>) => logger.log("error", m, d),
};

// ---------- Envelope-style token encryption (local key stands in for KMS) ----------
function dataKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  // Dev fallback: derived key. Production must set TOKEN_ENCRYPTION_KEY from KMS/vault.
  return createHash("sha256").update("dotaka-dev-only-key").digest();
}
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", dataKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** Wraps external content so models treat it as data, never instructions (spec §15). */
export function untrusted(label: string, content: string): string {
  const clean = content.replace(/<\/?untrusted[^>]*>/gi, "");
  return `<untrusted source="${label}">\n${clean}\n</untrusted>`;
}

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export * from "./phone.ts";
