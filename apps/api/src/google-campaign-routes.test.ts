import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { activeAdBudget, fitText, cleanAdText, defaultMaxCpc } from "@dotaka/orchestrator";
import { errorHandler } from "./http.ts";
import { googleAdsRoutes } from "./routes/google-ads.ts";

/**
 * Tạo chiến dịch Google theo mục tiêu (Search): soạn từ DNA, kiểm trước, tạo, tự động một lệnh. DB :memory:, tài khoản demo
 * (sandbox) — không gọi Google. Phần gọi Google thật được kiểm ở packages/connectors/src/google/create.test.ts.
 */
let B: string, app: FastifyInstance, acc: Row;
const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as any, headers: { "x-biz-id": B } });
const get = (url: string) => app.inject({ method: "GET", url, headers: { "x-biz-id": B } });
const body = (over: Record<string, unknown> = {}) => ({
  adAccountId: acc.id, objective: "leads", dailyBudget: 300_000, startPaused: true, name: "chien-dich-thu", finalUrl: "https://taki.vn/ai",
  keywords: [{ text: "khóa học ai", match: "PHRASE" }, { text: "khóa học ai", match: "EXACT" }],
  headlines: ["Khóa học AI cho CEO", "Đăng ký tư vấn ngay", "TAKI Academy"], descriptions: ["Học AI ứng dụng vào doanh nghiệp, làm được ngay.", "Liên hệ để được tư vấn lộ trình phù hợp."], ...over,
});

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "TAKI", settings: { ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 50 }, llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "t", data: {
    company: { brand: "TAKI Academy", website: "taki.vn", industry: "Đào tạo AI" }, forbiddenClaims: ["cam kết thu nhập"], bannedChars: ["—"],
    products: [{ key: "abs", name: "AI Business System", link: "https://aibusinesssystem.taki.vn", price: "9.800.000đ", summary: "Chương trình 3 ngày giúp CEO ứng dụng AI vào vận hành doanh nghiệp.", sellingPoints: ["Học thực hành", "Có mẫu quy trình"] }],
  } });
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  googleAdsRoutes(app);
  await app.ready();
});
afterAll(async () => { await app.close(); closeDb(); });
beforeEach(() => {
  for (const t of ["ad", "campaign", "ad_account", "action", "audit_log"]) try { q.run(`DELETE FROM ${t}`); } catch { /* bảng không có */ }
  q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 50 }, llm: { provider: "sandbox" } }), B);
  acc = insert("ad_account", { biz_id: B, platform: "google_ads", external_id: "2220000000", name: "TAKI Search", currency: "VND", status: "active", whitelisted: 1, meta: {} });
});

describe("Google: soạn chiến dịch theo mục tiêu", () => {
  it("options trả mục tiêu và sản phẩm trong DNA", async () => {
    const r = (await get("/v1/ads/google/options")).json();
    expect(r.objectives.map((o: any) => o.key)).toEqual(["traffic", "leads", "sales"]);
    expect(r.products[0]).toMatchObject({ key: "abs", name: "AI Business System" });
    expect(r.website).toBe("taki.vn");
  });

  it("plan: ra bộ tiêu đề / mô tả / từ khóa đúng giới hạn Google, URL lấy từ sản phẩm, đổi theo mục tiêu", async () => {
    const leads = (await post("/v1/ads/google/plan", { objective: "leads", productKey: "abs" })).json();
    const sales = (await post("/v1/ads/google/plan", { objective: "sales", productKey: "abs" })).json();
    expect(leads.finalUrl).toBe("https://aibusinesssystem.taki.vn/");
    expect(leads.source).toBe("template");
    expect(leads.headlines.length).toBeGreaterThanOrEqual(3);
    expect(leads.descriptions.length).toBeGreaterThanOrEqual(2);
    for (const h of leads.headlines) { expect(Array.from(h).length).toBeLessThanOrEqual(30); expect(h).not.toContain("!"); }
    for (const d of leads.descriptions) expect(Array.from(d).length).toBeLessThanOrEqual(90);
    expect(leads.keywords.some((k: any) => /tư vấn|đăng ký|báo giá/.test(k.text))).toBe(true);
    expect(sales.keywords.some((k: any) => /mua|giá|đặt mua/.test(k.text))).toBe(true);
    expect(leads.headlines).toContain("Đăng ký tư vấn ngay");
    expect(sales.headlines).toContain("Đặt mua ngay hôm nay");
    expect(leads.headlines.join(" ")).toContain("9.800.000"); // giá thật từ DNA
  });

  it("plan: không có sản phẩm / URL → nói rõ cần gì; dùng website của DNA khi chỉ nhập tên", async () => {
    const r = await post("/v1/ads/google/plan", { objective: "traffic", productKey: "khong-co" });
    expect(r.statusCode).toBe(404);
    const t = (await post("/v1/ads/google/plan", { objective: "traffic", topic: "Khóa học Zalo" })).json();
    expect(t.finalUrl).toBe("https://taki.vn/");
    expect(t.keywords[0].text).toBe("Khóa học Zalo");
  });
});

describe("Google: tạo chiến dịch", () => {
  it("tài khoản demo: check không gọi Google; tạo ghi chiến dịch + quảng cáo + nhật ký, mặc định TẠM DỪNG", async () => {
    const chk = (await post("/v1/ads/google/check", body())).json();
    expect(chk).toMatchObject({ ok: true, live: false, bidding: "maximize_conversions" });

    const r = await post("/v1/ads/google/campaign", body());
    expect(r.statusCode).toBe(200);
    const out = r.json();
    expect(out).toMatchObject({ status: "paused", bidding: "maximize_conversions", name: "chien-dich-thu" });
    const camp = q.get<Row>("SELECT * FROM campaign WHERE biz_id = ?", B)!;
    expect(camp).toMatchObject({ platform: "google_ads", objective: "leads", status: "paused", daily_budget: 300_000 });
    const ad = q.get<Row>("SELECT * FROM ad WHERE biz_id = ?", B)!;
    expect(ad).toMatchObject({ platform: "google_ads", external_id: camp.external_id, status: "paused", daily_budget: 300_000, post_id: null });
    expect(ad.meta).toMatchObject({ budgetOwnerId: camp.external_id, channelType: "SEARCH", source: "taki_create" });
    expect(q.get<Row>("SELECT * FROM action WHERE type = 'create_campaign'")).toMatchObject({ status: "done", reversible: 0 });
    expect(activeAdBudget(B)).toBe(0); // tạm dừng → chưa tính vào ngân sách đang chạy
    const recent = (await get("/v1/ads/google/recent")).json();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ status: "done", ad_status: "paused" });
  });

  it("chạy ngay tính vào trần tổng ngân sách ngày", async () => {
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxTotalDailyAdBudget: 200_000, maxAdsCreatedPerDay: 50 }, llm: { provider: "sandbox" } }), B);
    const over = await post("/v1/ads/google/campaign", body({ startPaused: false }));
    expect(over.statusCode).toBe(400);
    expect(over.json().message).toMatch(/trần tổng ngân sách/);
    expect((await post("/v1/ads/google/campaign", body({ startPaused: true }))).statusCode).toBe(200); // tạm dừng thì được
  });

  it("giới hạn số lượt tạo / ngày, dừng khẩn cấp, whitelist, sai nền tảng", async () => {
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 1 }, llm: { provider: "sandbox" } }), B);
    expect((await post("/v1/ads/google/campaign", body({ name: "a" }))).statusCode).toBe(200);
    expect((await post("/v1/ads/google/campaign", body({ name: "b" }))).json().message).toMatch(/giới hạn 1 lượt/);

    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, killSwitch: { ...DEFAULT_SETTINGS.killSwitch, ads: true }, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 50 } }), B);
    expect((await post("/v1/ads/google/campaign", body())).json().message).toMatch(/dừng khẩn cấp/);

    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 50 } }), B);
    q.run("UPDATE ad_account SET whitelisted = 0 WHERE id = ?", acc.id);
    expect((await post("/v1/ads/google/campaign", body())).json().message).toMatch(/whitelist/);
    const meta = insert("ad_account", { biz_id: B, platform: "meta", external_id: "act_1", name: "FB", currency: "VND", status: "active", whitelisted: 1, meta: {} });
    expect((await post("/v1/ads/google/campaign", body({ adAccountId: meta.id }))).json().message).toMatch(/không phải tài khoản Google/);
  });

  it("nội dung vượt giới hạn Google bị chặn trước khi gọi Google, và lần lỗi không để lại chiến dịch", async () => {
    // tiêu đề 3 dài 40 ký tự: bị cắt gọn về 30 (làm sạch) nên vẫn tạo được; thiếu URL hợp lệ thì chặn
    const bad = await post("/v1/ads/google/campaign", body({ finalUrl: "không phải url" }));
    expect(bad.statusCode).toBe(400);
    expect(q.scalar<number>("SELECT COUNT(*) FROM campaign")).toBe(0);
    expect(q.get<Row>("SELECT status FROM action WHERE type = 'create_campaign'")).toMatchObject({ status: "failed" });
    const chk = (await post("/v1/ads/google/check", body({ finalUrl: "không phải url" }))).json();
    expect(chk.ok).toBe(false);
    expect(chk.error).toMatch(/URL/);
  });

  it("tự động theo mục tiêu: một lệnh soạn từ DNA rồi tạo (tạm dừng), kèm bản soạn để Sếp xem lại", async () => {
    const r = await post("/v1/ads/google/auto", { adAccountId: acc.id, objective: "sales", productKey: "abs", dailyBudget: 500_000 });
    expect(r.statusCode).toBe(200);
    const out = r.json();
    expect(out.status).toBe("paused");
    expect(out.plan).toMatchObject({ objective: "sales", finalUrl: "https://aibusinesssystem.taki.vn/" });
    expect(out.bidding).toBe("maximize_conversion_value");
    expect(q.get<Row>("SELECT * FROM campaign WHERE biz_id = ?", B)).toMatchObject({ objective: "sales", daily_budget: 500_000 });
    expect(byId<Row>("ad", out.adId)!.meta.source).toBe("taki_create");
  });

  it("tự động: không có URL ở đâu cả → báo cần URL, không tạo gì", async () => {
    q.run("UPDATE dna_profile SET data = ? WHERE biz_id = ?", JSON.stringify({ company: { brand: "X" }, products: [] }), B);
    const r = await post("/v1/ads/google/auto", { adAccountId: acc.id, objective: "traffic", topic: "Sản phẩm X", dailyBudget: 200_000 });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/URL/);
    expect(q.scalar<number>("SELECT COUNT(*) FROM campaign")).toBe(0);
  });
});

describe("Google: làm sạch chữ quảng cáo", () => {
  it("cắt theo từ, bỏ emoji, dấu ! ở tiêu đề, IN HOA cả từ dài, ký tự cấm của DNA", () => {
    expect(fitText("Chương trình đào tạo AI cho chủ doanh nghiệp Việt Nam", 30)).toBe("Chương trình đào tạo AI"); // cắt theo từ, bỏ từ nối "cho" thừa ở cuối
    expect(cleanAdText("🔥 MIỄN PHÍ học thử!!! hôm nay", "headline")).toBe("Miễn phí học thử hôm nay");
    expect(cleanAdText("Học AI cho CEO cùng TAKI", "headline", [], ["TAKI"])).toBe("Học AI cho CEO cùng TAKI"); // viết tắt & tên thương hiệu giữ nguyên
    expect(cleanAdText("KHÓA HỌC AI CHO CEO", "headline")).toBe("Khóa học ai cho ceo");
    expect(cleanAdText("Học AI — ứng dụng ngay", "description", ["—"])).toBe("Học AI , ứng dụng ngay");
    expect(cleanAdText("Mua ngay!", "description")).toBe("Mua ngay!");
    expect(defaultMaxCpc(300_000)).toBe(60_000);
  });
});
