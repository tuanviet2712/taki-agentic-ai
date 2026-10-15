// Chép từ auto-funnel core/thi-nghiem.ts (phần chia bản): A/B tiêu đề chiến dịch email, tất định theo người nhận.

/** FNV-1a 32-bit — hash ổn định đa nền tảng cho phân bản. */
export function bamFnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Phân bản sticky: cùng (người nhận, thí nghiệm) luôn cùng bản. tyLeB = 0–100. */
export function phanBan(nguoiId: string, thiNghiemId: string, tyLeB: number): "a" | "b" {
  return bamFnv(`${thiNghiemId}:${nguoiId}`) % 100 < tyLeB ? "b" : "a";
}
