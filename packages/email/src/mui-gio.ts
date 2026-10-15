// Múi giờ theo WORKSPACE. Trước Đợt 29 giờ VN được cộng tay (+7h) hoặc ghi chết
// "Asia/Ho_Chi_Minh" ở gần 70 chỗ, trong khi bảng workspace đã có cột mui_gio mà không ai đọc —
// bán white-label cho đối tác ngoài VN là mọi mốc giờ lệch. TZDate quy đổi qua Intl, không cộng tay
// nên đúng cả với múi giờ có DST (Sydney, London…).
import { TZDate } from "@date-fns/tz";

export const MUI_GIO_MAC_DINH = "Asia/Ho_Chi_Minh";

/** Múi giờ hợp lệ theo IANA không? Sai thì rơi về mặc định thay vì ném lỗi giữa luồng gửi. */
export function muiGioHopLe(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export const chuanMuiGio = (tz?: string | null): string => (muiGioHopLe(tz) ? tz! : MUI_GIO_MAC_DINH);

/** Giờ trong ngày (0–23) tại múi giờ đã cho. */
export const gioTai = (d: Date, tz: string = MUI_GIO_MAC_DINH): number => new TZDate(d, chuanMuiGio(tz)).getHours();

/** Thứ trong tuần tại múi giờ đã cho (0 = Chủ nhật). */
export const thuTai = (d: Date, tz: string = MUI_GIO_MAC_DINH): number => new TZDate(d, chuanMuiGio(tz)).getDay();

export const laThuHai = (d: Date, tz: string = MUI_GIO_MAC_DINH): boolean => thuTai(d, tz) === 1;

/** Ngày dạng YYYY-MM-DD tại múi giờ đã cho (dùng cho khoá theo ngày, báo cáo). */
export function ngayTai(d: Date, tz: string = MUI_GIO_MAC_DINH): string {
  const t = new TZDate(d, chuanMuiGio(tz));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/**
 * Mốc UTC ứng với «đúng HH:mm ngày thứ N kể từ mốc gốc, tính theo múi giờ tz».
 * Dùng thay cho mẹo cộng offset rồi setUTCHours — cách cũ sai vào ngày đổi giờ.
 */
export function datGioPhutTai(goc: Date, gio: number, phut: number, tz: string = MUI_GIO_MAC_DINH, congNgay = 0): Date {
  const t = new TZDate(goc, chuanMuiGio(tz));
  t.setDate(t.getDate() + congNgay);
  t.setHours(gio, phut, 0, 0);
  return new Date(t.getTime());
}

export function datGioTai(goc: Date, gio: number, tz: string = MUI_GIO_MAC_DINH, congNgay = 0): Date {
  const t = new TZDate(goc, chuanMuiGio(tz));
  t.setDate(t.getDate() + congNgay);
  t.setHours(gio, 0, 0, 0);
  return new Date(t.getTime());
}

/** Hiển thị cho người đọc, theo múi giờ workspace. */
export function hienThiGio(d: Date, tz: string = MUI_GIO_MAC_DINH, tuyChon: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: chuanMuiGio(tz), day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", ...tuyChon,
  }).format(d);
}
