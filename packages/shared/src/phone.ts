/**
 * SĐT Việt Nam: chuẩn hoá, tìm trong tin nhắn, che bớt số (PII).
 * Cùng quy tắc với normalizeVnMobile của ZL-CRM (services/zl-crm/backend/src/shared/utils/phone.ts):
 * chỉ di động 10 số đầu 0[35789]; chấp nhận 0xxx, 84xxx, +84xxx, +84 0xxx và 9 số không có 0 đầu.
 */
const MOBILE = /^0[35789]\d{8}$/;

/** "0912 345 678" | "+84 912345678" | "+84 0912345678" | "84912345678" | "912345678" → "0912345678"; không hợp lệ → null. */
export function normalizeVnPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if (d.startsWith("840") && d.length === 12) d = d.slice(2); // "+84 0912…": số 0 thừa sau mã nước
  else if (d.startsWith("84") && d.length === 11) d = `0${d.slice(2)}`;
  else if (d.length === 9 && /^[35789]/.test(d)) d = `0${d}`;
  return MOBILE.test(d) ? d : null;
}

/** Dạng quốc tế không dấu + (Zalo/ZL-CRM dùng): "0912345678" → "84912345678". */
export const toIntlVnPhone = (phone: string) => `84${phone.replace(/^0/, "")}`;

// Một cụm số có thể lẫn khoảng trắng / chấm / gạch: "0912.345.678", "+84 912 345 678", "0912 345 678 0987 654 321"
const CANDIDATE = /\+?\d[\d\s.\-()]{6,40}\d/g;
// Ngay sau cụm số là đơn vị tiền → đó là số tiền, không phải SĐT ("390.000.000đ", "1.250.000 vnđ", "2 triệu").
const CURRENCY_AFTER = /^\s*(?:đ|₫|vn[dđ]|đồng|dong|k|tr|triệu|trieu|nghìn|nghin|ngàn|ngan)(?![\p{L}\d])/iu;
// Số tiền tách hàng nghìn: số đầu 1-3 chữ số không bắt đầu bằng 0, sau đó các nhóm đúng 3 số ("390.000.000").
const THOUSANDS = /^[1-9]\d{0,2}(?:[.,]\d{3})+$/;

/**
 * Ghép các nhóm số LIỀN NHAU (nguyên nhóm, không cắt giữa nhóm) thành 1 SĐT: đủ 10 số 0[35789]…, hoặc 84 + 9 số,
 * hoặc "+84 0…" (bỏ số 0 thừa sau mã nước). Không nhận 9 số trần ở đây (dễ nhầm khi ghép nhóm của số khác).
 */
function joinedPhone(digits: string): string | null {
  if (MOBILE.test(digits)) return digits;
  if (/^84[35789]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^840[35789]\d{8}$/.test(digits)) return digits.slice(2);
  return null;
}

type Hit = { phone: string; start: number; end: number }; // vị trí trong cụm (để che đúng chỗ)
type Candidate = { text: string; index: number; amount: boolean; hits: Hit[] };

function* candidates(text: string): Generator<Candidate> {
  for (const m of text.matchAll(CANDIDATE)) {
    const s = m[0];
    const index = m.index ?? 0;
    const amount = THOUSANDS.test(s) || CURRENCY_AFTER.test(text.slice(index + s.length));
    const hits: Hit[] = [];
    if (!amount) {
      const groups = [...s.matchAll(/\d+/g)].map((g) => ({ d: g[0], start: g.index ?? 0, end: (g.index ?? 0) + g[0].length }));
      const whole = groups.map((g) => g.d).join("");
      // Cả cụm đúng 9 số không có 0 đầu ("912345678") → vẫn nhận như trước.
      if (whole.length === 9 && /^[35789]/.test(whole)) hits.push({ phone: `0${whole}`, start: groups[0].start, end: groups[groups.length - 1].end });
      else {
        for (let i = 0; i < groups.length; i++) {
          let best = -1, phone: string | null = null, acc = "";
          for (let j = i; j < groups.length && (acc += groups[j].d).length <= 12; j++) {
            const p = joinedPhone(acc);
            if (p) { best = j; phone = p; }
          }
          if (phone) { hits.push({ phone, start: i === 0 ? 0 : groups[i].start, end: groups[best].end }); i = best; } // i=0: che cả dấu "+"
        }
      }
    }
    yield { text: s, index, amount, hits };
  }
}

/** Mọi SĐT di động VN trong 1 đoạn chữ (đã chuẩn hoá, không trùng), theo thứ tự xuất hiện. */
export function extractVnPhones(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const c of candidates(String(text ?? ""))) for (const h of c.hits) if (!out.includes(h.phone)) out.push(h.phone);
  return out;
}
export const extractVnPhone = (text: string | null | undefined): string | null => extractVnPhones(text)[0] ?? null;

/** "0912345678" → "0912***678" (hiển thị / nhật ký). */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return d ? "***" : "";
  return `${d.slice(0, 4)}***${d.slice(-3)}`;
}

/** Che mọi SĐT trong đoạn chữ trước khi gửi cho model ngoài / ghi log: "zalo 0912 345 678" → "zalo 0912***678". Giá tiền giữ nguyên. */
export function maskPhonesInText(text: string): string {
  const src = String(text ?? "");
  let out = "", last = 0;
  for (const c of candidates(src)) {
    let masked: string;
    if (c.amount) masked = c.text;
    else if (c.hits.length) {
      masked = "";
      let at = 0;
      for (const h of c.hits) { masked += c.text.slice(at, h.start) + maskPhone(h.phone); at = h.end; }
      masked += c.text.slice(at);
    } else {
      // Cụm dài không nhận ra SĐT (mã đơn, số lạ dính nhau): che hết chữ số trừ 4 đầu, 3 cuối cho chắc.
      const digits = c.text.replace(/\D/g, "");
      let seen = 0;
      masked = digits.length < 9 ? c.text : c.text.replace(/\d/g, (d) => (seen++ < 4 || seen > digits.length - 3 ? d : "*"));
    }
    out += src.slice(last, c.index) + masked;
    last = c.index + c.text.length;
  }
  return out + src.slice(last);
}

/** Khách nhắc tới Zalo ("zalo", "za lô", "zl") — để biết khách muốn liên hệ qua Zalo. */
export const mentionsZalo = (text: string) => /(^|[^\p{L}])(zalo|za\s?lô|zl)([^\p{L}]|$)/iu.test(String(text ?? ""));
