// Chép từ auto-funnel core/luong.ts (phần email dùng): khung giờ gửi hợp lệ + dọn biến sót.
import { MUI_GIO_MAC_DINH, datGioTai, gioTai } from "./mui-gio.ts";

export type KhungGio = { tu: number; den: number }; // giờ địa phương, ví dụ 8 → 21
export const KHUNG_GIO_MAC_DINH: KhungGio = { tu: 8, den: 21 };

/** Mốc gửi rơi ngoài khung giờ → dồn sang đầu khung (hôm nay nếu còn sớm, ngày mai nếu đã quá giờ). */
export function gioGuiHopLe(mong: Date, khung: KhungGio = KHUNG_GIO_MAC_DINH, muiGio: string = MUI_GIO_MAC_DINH): Date {
  const gio = gioTai(mong, muiGio);
  if (gio >= khung.tu && gio < khung.den) return mong;
  return datGioTai(mong, khung.tu, muiGio, gio >= khung.den ? 1 : 0);
}

/** Thay biến thương hiệu/khách trong template ({{ho_ten}}, {{ten_thuong_hieu}}…) — biến lạ giữ nguyên fallback. */
export function thayBien(text: string, bien: Record<string, string | null | undefined>, duPhong = "bạn"): string {
  return text.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (goc, ten: string) => {
    const v = bien[ten];
    return v && String(v).trim() ? String(v) : ten === "ho_ten" ? duPhong : goc === text ? goc : "";
  });
}
