import { bizSettings } from "@dotaka/db";

/** Khung giờ đăng mặc định (giờ VN). Feedback loop đề xuất đổi qua change_proposal "posting_schedule". */
export const DEFAULT_SLOTS = [8, 11.5, 20];
/** Giới hạn giờ đăng được phép tự đề xuất (AUTO_APPLY_POLICY.posting_schedule.boundsHours). */
export const SLOT_BOUNDS: [number, number] = [7, 22];
const VN_OFFSET_MS = 7 * 3600_000; // Asia/Ho_Chi_Minh, không có giờ mùa hè

export function validSlots(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const s = [...new Set(v.map(Number).filter((h) => Number.isFinite(h) && h >= SLOT_BOUNDS[0] && h <= SLOT_BOUNDS[1]))].sort((a, b) => a - b);
  return s.length ? s.slice(0, 6) : null;
}

/** Khung giờ đăng của biz: cài đặt `postingSlots` (đã áp dụng từ đề xuất) hoặc mặc định. */
export function postingSlots(bizId: string): number[] {
  return validSlots((bizSettings(bizId) as any).postingSlots) ?? DEFAULT_SLOTS;
}

/** Giờ địa phương (VN, dạng số thập phân 0–24) của một thời điểm. */
export function localHour(d: Date): number {
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  return t.getUTCHours() + t.getUTCMinutes() / 60;
}

/** Thời điểm khung giờ đăng kế tiếp (≥ 10 phút nữa) theo giờ VN; skip = số khung đã có bài chờ đăng → lấy khung sau đó. */
export function nextSlotAt(slots: number[], from = new Date(), skip = 0): Date {
  const minAt = from.getTime() + 10 * 60_000;
  const local = new Date(from.getTime() + VN_OFFSET_MS);
  const dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VN_OFFSET_MS;
  let left = Math.max(0, skip);
  for (let day = 0; day < 14; day++) {
    for (const h of slots) {
      const at = dayStartUtc + day * 86400_000 + Math.round(h * 3600_000);
      if (at >= minAt && left-- === 0) return new Date(at);
    }
  }
  return new Date(minAt);
}
