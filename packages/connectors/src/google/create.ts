import { ConnectorError } from "../errors.ts";

/**
 * Tạo chiến dịch Google Ads (Search) theo MỤC TIÊU. Một lệnh `googleAds:mutate` duy nhất chứa cả chuỗi
 * ngân sách → chiến dịch → nhắm mục tiêu → nhóm quảng cáo → quảng cáo → từ khóa, nối nhau bằng id tạm (số âm):
 * Google ghi tất cả hoặc không ghi gì (partial_failure = false) nên KHÔNG bao giờ để lại chiến dịch dở dang,
 * và `validateOnly` kiểm tra TOÀN BỘ chuỗi mà không tạo gì (tốt hơn kiểm một phần của Facebook).
 */
export type GoogleObjective = "traffic" | "leads" | "sales";
export type GoogleBidding = "maximize_clicks" | "maximize_conversions" | "maximize_conversion_value";
export type GoogleMatch = "PHRASE" | "EXACT" | "BROAD";

export const GOOGLE_OBJECTIVES: Record<GoogleObjective, { label: string; hint: string; cta: string; modifiers: string[] }> = {
  traffic: { label: "Truy cập website", hint: "Kéo nhiều người vào website. Tối đa số lượt nhấp trong ngân sách.", cta: "Tìm hiểu ngay", modifiers: ["là gì", "thông tin", "review"] },
  leads: { label: "Khách hàng tiềm năng", hint: "Lấy đăng ký / tư vấn. Tối ưu số chuyển đổi nếu tài khoản đã cài theo dõi chuyển đổi.", cta: "Đăng ký tư vấn ngay", modifiers: ["đăng ký", "tư vấn", "báo giá", "liên hệ"] },
  sales: { label: "Bán hàng", hint: "Ra đơn / doanh thu. Từ khóa có ý định mua; tối ưu giá trị chuyển đổi nếu đã cài theo dõi.", cta: "Đặt mua ngay hôm nay", modifiers: ["mua", "giá", "đặt mua", "khuyến mãi"] },
};
export const isGoogleObjective = (x: unknown): x is GoogleObjective => typeof x === "string" && x in GOOGLE_OBJECTIVES;

/**
 * Chiến lược giá thầu theo mục tiêu. Tối ưu theo chuyển đổi chỉ có nghĩa khi tài khoản đã có hành động chuyển đổi
 * (không có dữ liệu thì Google không có gì để tối ưu) → khi chưa có, chạy "Tối đa lượt nhấp" và nói rõ cho người dùng.
 */
export function resolveGoogleBidding(objective: GoogleObjective, hasConversionTracking: boolean): { bidding: GoogleBidding; note: string | null } {
  if (objective === "traffic") return { bidding: "maximize_clicks", note: null };
  if (!hasConversionTracking) return { bidding: "maximize_clicks", note: "Tài khoản chưa có theo dõi chuyển đổi nên chạy \"Tối đa lượt nhấp\". Cài theo dõi chuyển đổi trên Google Ads rồi đổi sang tối ưu chuyển đổi." };
  return { bidding: objective === "sales" ? "maximize_conversion_value" : "maximize_conversions", note: null };
}

export interface GoogleSearchCampaignSpec {
  name: string;
  accountExternalId: string;
  /** Đơn vị lớn của tiền tệ tài khoản (VND = đồng). */
  dailyBudget: number;
  startPaused: boolean;
  objective: GoogleObjective;
  bidding: GoogleBidding;
  /** Trần giá mỗi lượt nhấp (chỉ dùng với "Tối đa lượt nhấp"). */
  maxCpc?: number | null;
  finalUrl: string;
  keywords: { text: string; match: GoogleMatch }[];
  headlines: string[];
  descriptions: string[];
  path1?: string; path2?: string;
  adGroupName?: string;
  /** Mặc định Việt Nam (2704) / tiếng Việt (1040). */
  geoTargetId?: number; languageId?: number;
}
export interface GoogleCreatedCampaign {
  campaignExternalId: string; adGroupExternalId: string | null; adExternalId: string | null;
  budgetResource: string | null; status: "active" | "paused"; bidding: GoogleBidding;
}

export const LIMITS = { headline: 30, description: 90, path: 15, name: 128, keyword: 80, maxKeywords: 30, maxHeadlines: 15, maxDescriptions: 4 } as const;
const len = (s: string) => Array.from(s.normalize("NFC")).length;
const bad = (msg: string) => new ConnectorError("InvalidRequest", msg);

/** Kiểm trước khi gọi Google: lỗi nói bằng lời của người dùng, chỉ đúng chỗ sai. */
export function validateGoogleSearchSpec(s: GoogleSearchCampaignSpec): void {
  if (!s.name.trim()) throw bad("Thiếu tên chiến dịch");
  if (len(s.name) > LIMITS.name) throw bad(`Tên chiến dịch dài quá ${LIMITS.name} ký tự`);
  if (!(s.dailyBudget > 0)) throw bad("Ngân sách ngày phải lớn hơn 0");
  if (!isGoogleObjective(s.objective)) throw bad("Mục tiêu không hợp lệ");
  let url: URL;
  try { url = new URL(s.finalUrl); } catch { throw bad("URL trang đích không hợp lệ (cần dạng https://…)"); }
  if (!/^https?:$/.test(url.protocol)) throw bad("URL trang đích phải bắt đầu bằng http:// hoặc https://");
  const kw = s.keywords.filter((k) => k.text.trim());
  if (!kw.length) throw bad("Cần ít nhất 1 từ khóa");
  if (kw.length > LIMITS.maxKeywords) throw bad(`Tối đa ${LIMITS.maxKeywords} từ khóa cho 1 nhóm`);
  for (const k of kw) {
    if (len(k.text) > LIMITS.keyword) throw bad(`Từ khóa "${k.text.slice(0, 30)}…" dài quá ${LIMITS.keyword} ký tự`);
    if (/[!@%,*^()={};~`<>?\\|]/.test(k.text)) throw bad(`Từ khóa "${k.text}" có ký tự Google không cho phép`);
  }
  if (s.headlines.length < 3) throw bad("Cần ít nhất 3 tiêu đề quảng cáo");
  if (s.headlines.length > LIMITS.maxHeadlines) throw bad(`Tối đa ${LIMITS.maxHeadlines} tiêu đề`);
  s.headlines.forEach((h, i) => {
    if (!h.trim()) throw bad(`Tiêu đề ${i + 1} đang trống`);
    if (len(h) > LIMITS.headline) throw bad(`Tiêu đề ${i + 1} dài ${len(h)} ký tự, tối đa ${LIMITS.headline}: "${h}"`);
    if (h.includes("!")) throw bad(`Tiêu đề ${i + 1} có dấu "!" — Google không cho phép trong tiêu đề`);
  });
  if (s.descriptions.length < 2) throw bad("Cần ít nhất 2 mô tả quảng cáo");
  if (s.descriptions.length > LIMITS.maxDescriptions) throw bad(`Tối đa ${LIMITS.maxDescriptions} mô tả`);
  s.descriptions.forEach((d, i) => {
    if (!d.trim()) throw bad(`Mô tả ${i + 1} đang trống`);
    if (len(d) > LIMITS.description) throw bad(`Mô tả ${i + 1} dài ${len(d)} ký tự, tối đa ${LIMITS.description}`);
  });
  for (const [n, p] of [["Đường dẫn hiển thị 1", s.path1], ["Đường dẫn hiển thị 2", s.path2]] as const) if (p && len(p) > LIMITS.path) throw bad(`${n} dài quá ${LIMITS.path} ký tự`);
  if (s.path2 && !s.path1) throw bad("Đường dẫn hiển thị 2 chỉ dùng được khi đã có đường dẫn 1");
  if (s.maxCpc != null && !(s.maxCpc > 0)) throw bad("Trần giá mỗi lượt nhấp phải lớn hơn 0");
}

/** amount_micros luôn là bội của 10.000 (đơn vị nhỏ nhất Google chấp nhận cho mọi tiền tệ). */
export const toMicros = (amount: number) => String(Math.round(amount * 100) * 10_000);

/**
 * Chuỗi thao tác của `googleAds:mutate`. Id tạm âm: -1 ngân sách, -2 chiến dịch, -3 nhóm quảng cáo. Thao tác chạy theo thứ tự,
 * cha phải đứng trước con. `uid` làm tên ngân sách duy nhất (Google bắt tên ngân sách không trùng).
 */
export function buildGoogleSearchOperations(customerId: string, s: GoogleSearchCampaignSpec, uid: string): Record<string, unknown>[] {
  const cid = String(customerId).replace(/\D/g, "");
  const budget = `customers/${cid}/campaignBudgets/-1`;
  const campaign = `customers/${cid}/campaigns/-2`;
  const adGroup = `customers/${cid}/adGroups/-3`;
  const status = s.startPaused ? "PAUSED" : "ENABLED";
  const bidding = s.bidding === "maximize_clicks"
    ? { targetSpend: s.maxCpc ? { cpcBidCeilingMicros: toMicros(s.maxCpc) } : {} }
    : s.bidding === "maximize_conversion_value" ? { maximizeConversionValue: {} } : { maximizeConversions: {} };
  const kws = s.keywords.filter((k) => k.text.trim());
  return [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${s.name.slice(0, 100)} · ngân sách ${uid}`, amountMicros: toMicros(s.dailyBudget), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: campaign, name: s.name.trim(), status, advertisingChannelType: "SEARCH", campaignBudget: budget, ...bidding,
      // Chỉ tìm kiếm Google: không đối tác tìm kiếm, không mạng hiển thị (chạy thử ngân sách nhỏ dễ bị hút vào chỗ rác).
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      // Chỉ người đang Ở vùng nhắm (không phải người "quan tâm" tới vùng đó).
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
      // Bắt buộc khai báo từ Google Ads API v19+: chiến dịch không quảng cáo chính trị EU.
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    } } },
    { campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${s.geoTargetId ?? 2704}` } } } },
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${s.languageId ?? 1040}` } } } },
    { adGroupOperation: { create: { resourceName: adGroup, name: (s.adGroupName || `${s.name} · nhóm 1`).slice(0, 255), campaign, status: "ENABLED", type: "SEARCH_STANDARD" } } },
    { adGroupAdOperation: { create: { adGroup, status: "ENABLED", ad: {
      finalUrls: [s.finalUrl],
      responsiveSearchAd: {
        headlines: s.headlines.map((text) => ({ text })), descriptions: s.descriptions.map((text) => ({ text })),
        ...(s.path1 ? { path1: s.path1 } : {}), ...(s.path1 && s.path2 ? { path2: s.path2 } : {}),
      },
    } } } },
    ...kws.map((k) => ({ adGroupCriterionOperation: { create: { adGroup, status: "ENABLED", keyword: { text: k.text.trim(), matchType: k.match } } } })),
  ];
}

/** id (số cuối) của resource do Google trả về, theo loại. */
export function parseMutateResponse(body: any, s: Pick<GoogleSearchCampaignSpec, "bidding" | "startPaused">): GoogleCreatedCampaign {
  const out: any[] = body?.mutateOperationResponses ?? [];
  const idOf = (key: string) => String(out.find((o) => o?.[key]?.resourceName)?.[key].resourceName ?? "").split("/").pop() || null;
  const campaignExternalId = idOf("campaignResult");
  if (!campaignExternalId) throw new ConnectorError("InvalidRequest", "Google Ads: phản hồi không có id chiến dịch — kiểm tra lại trên Google Ads trước khi tạo lại");
  return {
    campaignExternalId, adGroupExternalId: idOf("adGroupResult"), adExternalId: idOf("adGroupAdResult"),
    budgetResource: out.find((o) => o?.campaignBudgetResult?.resourceName)?.campaignBudgetResult.resourceName ?? null,
    status: s.startPaused ? "paused" : "active", bidding: s.bidding,
  };
}
