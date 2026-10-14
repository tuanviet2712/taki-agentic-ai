import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGoogleError, googleAdsConnector } from "./ads.ts";
import { buildGoogleSearchOperations, parseMutateResponse, resolveGoogleBidding, toMicros, validateGoogleSearchSpec, type GoogleSearchCampaignSpec } from "./create.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = JSON.stringify({ type: "service_account", client_email: "ads@proj.iam.gserviceaccount.com", private_key: privateKey });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

const spec = (over: Partial<GoogleSearchCampaignSpec> = {}): GoogleSearchCampaignSpec => ({
  name: "20261014_taki_ai_leads_search", accountExternalId: "222-000-0000", dailyBudget: 300_000, startPaused: true, objective: "leads", bidding: "maximize_conversions",
  finalUrl: "https://taki.vn/khoa-hoc", keywords: [{ text: "khóa học ai", match: "PHRASE" }, { text: "khóa học ai", match: "EXACT" }],
  headlines: ["Khóa học AI cho CEO", "Đăng ký tư vấn ngay", "TAKI Academy"], descriptions: ["Học AI ứng dụng vào doanh nghiệp, làm được ngay sau buổi học.", "Liên hệ để được tư vấn lộ trình phù hợp."], ...over,
});

describe("google ads: mục tiêu → chiến lược giá thầu", () => {
  it("truy cập luôn tối đa lượt nhấp; tiềm năng / bán hàng chỉ tối ưu chuyển đổi khi tài khoản đã có theo dõi", () => {
    expect(resolveGoogleBidding("traffic", true).bidding).toBe("maximize_clicks");
    expect(resolveGoogleBidding("leads", true).bidding).toBe("maximize_conversions");
    expect(resolveGoogleBidding("sales", true).bidding).toBe("maximize_conversion_value");
    const none = resolveGoogleBidding("leads", false);
    expect(none.bidding).toBe("maximize_clicks");
    expect(none.note).toMatch(/theo dõi chuyển đổi/);
  });
});

describe("google ads: kiểm tra nội dung trước khi gọi Google", () => {
  it("chấp nhận bộ hợp lệ", () => expect(() => validateGoogleSearchSpec(spec())).not.toThrow());
  it.each([
    [{ headlines: ["a", "b"] }, /ít nhất 3 tiêu đề/],
    [{ headlines: ["Khóa học AI cho CEO", "Đăng ký tư vấn ngay", "Tiêu đề này dài hơn ba mươi ký tự rất nhiều"] }, /Tiêu đề 3 dài \d+ ký tự, tối đa 30/],
    [{ headlines: ["Mua ngay!", "Đăng ký tư vấn ngay", "TAKI Academy"] }, /dấu "!"/],
    [{ descriptions: ["chỉ một mô tả"] }, /ít nhất 2 mô tả/],
    [{ descriptions: ["x".repeat(91), "ok"] }, /Mô tả 1 dài 91/],
    [{ keywords: [] }, /ít nhất 1 từ khóa/],
    [{ keywords: [{ text: "mua giá rẻ!!!", match: "PHRASE" as const }] }, /ký tự Google không cho phép/],
    [{ finalUrl: "taki.vn" }, /URL trang đích không hợp lệ/],
    [{ finalUrl: "ftp://taki.vn" }, /http/],
    [{ dailyBudget: 0 }, /Ngân sách/],
    [{ path2: "abc" }, /đường dẫn 1/i],
  ])("từ chối %# bằng lời dễ hiểu", (over, msg) => expect(() => validateGoogleSearchSpec(spec(over as any))).toThrow(msg));
});

describe("google ads: chuỗi thao tác tạo chiến dịch", () => {
  const ops = () => buildGoogleSearchOperations("222-000-0000", spec(), "abc");
  it("ngân sách → chiến dịch → khu vực / ngôn ngữ → nhóm → quảng cáo → từ khóa, nối bằng id tạm; tạm dừng khi startPaused", () => {
    const o = ops();
    expect(o.map((x) => Object.keys(x)[0])).toEqual(["campaignBudgetOperation", "campaignOperation", "campaignCriterionOperation", "campaignCriterionOperation", "adGroupOperation", "adGroupAdOperation", "adGroupCriterionOperation", "adGroupCriterionOperation"]);
    const budget = (o[0] as any).campaignBudgetOperation.create;
    const camp = (o[1] as any).campaignOperation.create;
    expect(budget).toMatchObject({ resourceName: "customers/2220000000/campaignBudgets/-1", amountMicros: "300000000000", explicitlyShared: false });
    expect(camp).toMatchObject({ status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: budget.resourceName, maximizeConversions: {}, containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" });
    expect(camp.networkSettings).toMatchObject({ targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false });
    expect((o[2] as any).campaignCriterionOperation.create).toMatchObject({ campaign: camp.resourceName, location: { geoTargetConstant: "geoTargetConstants/2704" } });
    expect((o[3] as any).campaignCriterionOperation.create).toMatchObject({ language: { languageConstant: "languageConstants/1040" } });
    const ad = (o[5] as any).adGroupAdOperation.create;
    expect(ad.ad.finalUrls).toEqual(["https://taki.vn/khoa-hoc"]);
    expect(ad.ad.responsiveSearchAd.headlines).toHaveLength(3);
    expect((o[7] as any).adGroupCriterionOperation.create.keyword).toEqual({ text: "khóa học ai", matchType: "EXACT" });
  });
  it("chạy ngay → ENABLED; tối đa lượt nhấp có trần giá nhấp; tối ưu giá trị chuyển đổi", () => {
    expect((buildGoogleSearchOperations("1", spec({ startPaused: false }), "x")[1] as any).campaignOperation.create.status).toBe("ENABLED");
    expect((buildGoogleSearchOperations("1", spec({ bidding: "maximize_clicks", maxCpc: 5000 }), "x")[1] as any).campaignOperation.create.targetSpend).toEqual({ cpcBidCeilingMicros: "5000000000" });
    expect((buildGoogleSearchOperations("1", spec({ bidding: "maximize_conversion_value" }), "x")[1] as any).campaignOperation.create.maximizeConversionValue).toEqual({});
  });
  it("ngân sách luôn là bội của 10.000 micros", () => {
    expect(toMicros(300_000)).toBe("300000000000");
    expect(Number(toMicros(12.345)) % 10_000).toBe(0);
  });
  it("đọc id chiến dịch / nhóm / quảng cáo từ phản hồi; thiếu id chiến dịch thì báo lỗi, không đoán", () => {
    const body = { mutateOperationResponses: [{ campaignBudgetResult: { resourceName: "customers/2/campaignBudgets/7" } }, { campaignResult: { resourceName: "customers/2/campaigns/99" } }, { adGroupResult: { resourceName: "customers/2/adGroups/55" } }, { adGroupAdResult: { resourceName: "customers/2/adGroupAds/55~66" } }] };
    expect(parseMutateResponse(body, { bidding: "maximize_clicks", startPaused: true })).toMatchObject({ campaignExternalId: "99", adGroupExternalId: "55", adExternalId: "55~66", budgetResource: "customers/2/campaignBudgets/7", status: "paused" });
    expect(() => parseMutateResponse({}, { bidding: "maximize_clicks", startPaused: true })).toThrow(/không có id chiến dịch/);
  });
});

describe("google ads: connector tạo chiến dịch", () => {
  const base = (extra: Record<string, (b: any) => Response>) => vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    const table: Record<string, (b: any) => Response> = {
      "oauth2.googleapis.com/token": () => json({ access_token: "ya29.x" }),
      ":listAccessibleCustomers": () => json({ resourceNames: ["customers/2220000000"] }),
      "googleAds:searchStream": (b) => json([{ results: String(b?.query).includes("conversion_action") ? [{ conversionAction: { id: "1" } }] : [{ customerClient: { id: "2220000000", descriptiveName: "A", manager: false, currencyCode: "VND" } }] }]),
      ...extra,
    };
    for (const [k, h] of Object.entries(table)) if (url.includes(k)) return h(body);
    throw new Error(`unexpected ${url}`);
  });

  it("gửi MỘT lệnh googleAds:mutate (không validateOnly), trả id chiến dịch", async () => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", base({ "googleAds:mutate": (b) => { sent.push(b); return json({ mutateOperationResponses: [{ campaignResult: { resourceName: "customers/2220000000/campaigns/4242" } }] }); } }));
    const r = await googleAdsConnector({ service_account_json: SA }).createSearchCampaign!(spec(), "k1");
    expect(r).toMatchObject({ campaignExternalId: "4242", status: "paused" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ validateOnly: false, partialFailure: false });
    expect(sent[0].mutateOperations).toHaveLength(8);
  });

  it("validateSearchCampaign đặt validateOnly = true", async () => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", base({ "googleAds:mutate": (b) => { sent.push(b); return json({}); } }));
    await googleAdsConnector({ service_account_json: SA }).validateSearchCampaign!(spec());
    expect(sent[0].validateOnly).toBe(true);
  });

  it("KHÔNG thử lại khi ghi lỗi 500 (tránh tạo trùng) và nói rõ cách kiểm tra", async () => {
    const mutate = vi.fn(() => json({ error: { message: "boom" } }, 500));
    vi.stubGlobal("fetch", base({ "googleAds:mutate": mutate }));
    await expect(googleAdsConnector({ service_account_json: SA }).createSearchCampaign!(spec(), "k2")).rejects.toThrow(/boom/);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("lỗi trùng tên + vị trí trường lỗi được dịch ra tiếng Việt", async () => {
    vi.stubGlobal("fetch", base({ "googleAds:mutate": () => json({ error: { code: 400, message: "Request contains an invalid argument.", details: [{ errors: [{ errorCode: { campaignError: "DUPLICATE_CAMPAIGN_NAME" }, message: "Campaign name is already used.", location: { fieldPathElements: [{ fieldName: "mutate_operations", index: 1 }, { fieldName: "campaign_operation" }, { fieldName: "create" }, { fieldName: "name" }] } }] }] } }, 400) }));
    await expect(googleAdsConnector({ service_account_json: SA }).createSearchCampaign!(spec(), "k3")).rejects.toThrow(/trùng tên/);
  });

  it("chỉ rõ tiêu đề nào sai theo số thứ tự", () => {
    const body = { error: { details: [{ errors: [{ errorCode: { adGroupAdError: "TOO_LONG" }, message: "Too long", location: { fieldPathElements: [{ fieldName: "mutate_operations", index: 5 }, { fieldName: "ad_group_ad_operation" }, { fieldName: "create" }, { fieldName: "ad" }, { fieldName: "responsive_search_ad" }, { fieldName: "headlines", index: 2 }] } }] }] } };
    expect(extractGoogleError(body, 400)).toMatch(/tiêu đề quảng cáo số 3/);
  });

  it("hasConversionTracking: có hành động chuyển đổi → true; lỗi → false", async () => {
    vi.stubGlobal("fetch", base({}));
    expect(await googleAdsConnector({ service_account_json: SA }).hasConversionTracking!("222-000-0000")).toBe(true);
    vi.stubGlobal("fetch", base({ "googleAds:searchStream": () => json({ error: { message: "x" } }, 403) }));
    expect(await googleAdsConnector({ service_account_json: SA }).hasConversionTracking!("222-000-0000")).toBe(false);
  });
});
