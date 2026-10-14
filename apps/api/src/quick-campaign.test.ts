import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { activeAdBudget, publishCandidate } from "@dotaka/orchestrator";
import { errorHandler } from "./http.ts";
import { connectRoutes } from "./routes/connect.ts";

/**
 * "Tạo chiến dịch" nhiều bài / nhiều nhóm (AI Agent Ads): công thức test 1:3:3, tự điều chỉnh, kiểm mẫu từng nhóm,
 * ngân sách tính theo nhóm. DB :memory:, tài khoản demo (sandbox) — không gọi Facebook.
 */
let B: string, app: FastifyInstance, acc: Row, page: Row;
const api = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as any, headers: { "x-biz-id": B } });
const post = (i: number) => ({ externalId: `P1_${i}`, text: `Bài số ${i} — nội dung`, permalink: null, kind: "post" });
const base = () => ({ adAccountId: acc.id, channelId: page.id, templateId: null, dailyBudget: 300_000, startPaused: true, confirm: true });

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, caps: { ...DEFAULT_SETTINGS.caps, maxAdsCreatedPerDay: 50 }, llm: { provider: "sandbox" } } }).id;
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  connectRoutes(app);
  await app.ready();
});
afterAll(async () => { await app.close(); closeDb(); });
beforeEach(() => {
  for (const t of ["ad", "campaign", "ad_candidate", "post", "post_ad_link", "ad_account", "channel", "ad_template", "job", "action"]) q.run(`DELETE FROM ${t}`);
  acc = insert("ad_account", { biz_id: B, platform: "meta", external_id: "act_1", name: "TK 02", currency: "VND", status: "active", whitelisted: 1, meta: {} });
  page = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Bảo Bảo Về Quê", external_id: "P1", enabled: 1, whitelisted: 1, meta: {} });
});

describe("POST /v1/ads/quick — chiến dịch nhiều nhóm", () => {
  it("test 1:3:3: 1 chiến dịch, 3 nhóm, mỗi nhóm 3 bài = 9 quảng cáo; ngân sách đếm 1 lần mỗi nhóm", async () => {
    const r = await api("/v1/ads/quick", { ...base(), mode: "test", posts: [post(1), post(2), post(3)], adsets: [{}, {}, {}], startPaused: false });
    expect(r.statusCode).toBe(200);
    const cand = r.json();
    expect(cand.options.structure).toMatchObject({ mode: "test", adsets: [{ dailyBudget: 300_000 }, { dailyBudget: 300_000 }, { dailyBudget: 300_000 }] });
    expect(cand.options.structure.postIds).toHaveLength(3);
    expect(cand.daily_budget).toBe(900_000);

    await publishCandidate(B, cand.id);
    expect(byId<Row>("ad_candidate", cand.id)!.status).toBe("published");
    expect(q.scalar<number>("SELECT COUNT(*) FROM campaign WHERE biz_id = ?", B)).toBe(1);
    const ads = q.all<Row>("SELECT * FROM ad WHERE biz_id = ? ORDER BY name", B);
    expect(ads).toHaveLength(9);
    expect(new Set(ads.map((a) => a.meta.budgetOwnerId)).size).toBe(3); // 3 nhóm
    expect(new Set(ads.map((a) => a.post_id)).size).toBe(3); // 3 bài
    expect(ads.every((a) => a.status === "active" && a.daily_budget === 300_000)).toBe(true);
    // 9 dòng quảng cáo nhưng chỉ 3 ngân sách nhóm: tổng đang chạy = 900k, không phải 2,7 triệu.
    expect(activeAdBudget(B)).toBe(900_000);
  });

  it("test 1:3:3 bắt buộc đúng 3 bài và 3 nhóm", async () => {
    const r = await api("/v1/ads/quick", { ...base(), mode: "test", posts: [post(1), post(2)], adsets: [{}, {}, {}] });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/1:3:3/);
    expect(q.scalar<number>("SELECT COUNT(*) FROM ad_candidate")).toBe(0);
  });

  it("tự điều chỉnh: 2 nhóm × 4 bài, ngân sách riêng từng nhóm", async () => {
    const r = await api("/v1/ads/quick", { ...base(), mode: "custom", posts: [post(1), post(2), post(3), post(4)], adsets: [{ dailyBudget: 200_000 }, { dailyBudget: 500_000 }] });
    expect(r.statusCode).toBe(200);
    await publishCandidate(B, r.json().id);
    const ads = q.all<Row>("SELECT * FROM ad WHERE biz_id = ?", B);
    expect(ads).toHaveLength(8);
    expect(ads.every((a) => a.status === "paused")).toBe(true); // startPaused
    expect(new Set(ads.map((a) => a.daily_budget))).toEqual(new Set([200_000, 500_000]));
  });

  it("mẫu riêng của một nhóm phải cùng mục tiêu với chiến dịch", async () => {
    const msg = insert("ad_template", { biz_id: B, name: "Tin nhắn HN", platform: "meta", definition: { objective: "messages" } });
    const eng = insert("ad_template", { biz_id: B, name: "Tương tác", platform: "meta", definition: { objective: "engagement" } });
    const bad = await api("/v1/ads/quick", { ...base(), templateId: msg.id, posts: [post(1)], adsets: [{}, { templateId: eng.id }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/cùng mục tiêu/);
    const ok = await api("/v1/ads/quick", { ...base(), templateId: msg.id, posts: [post(1)], adsets: [{}, { templateId: msg.id }] });
    expect(ok.statusCode).toBe(200);
  });

  it("vẫn nhận kiểu cũ 1 bài (`post`): 1 nhóm, 1 quảng cáo, không có cấu trúc", async () => {
    const r = await api("/v1/ads/quick", { ...base(), post: post(7) });
    expect(r.statusCode).toBe(200);
    expect(r.json().options.structure).toBeUndefined();
    await publishCandidate(B, r.json().id);
    expect(q.scalar<number>("SELECT COUNT(*) FROM ad WHERE biz_id = ?", B)).toBe(1);
  });

  it("Tạo lại lần tạo bị lỗi: lượt mới giữ nguyên cấu trúc; lần chưa lỗi thì không cho tạo lại", async () => {
    const r = await api("/v1/ads/quick", { ...base(), mode: "test", posts: [post(1), post(2), post(3)], adsets: [{}, {}, {}] });
    const id = r.json().id;
    expect((await api(`/v1/ads/quick/${id}/retry`, {})).statusCode).toBe(400); // chưa lỗi
    q.run("UPDATE ad_candidate SET status = 'failed' WHERE id = ?", id);
    const again = await api(`/v1/ads/quick/${id}/retry`, {});
    expect(again.statusCode).toBe(200);
    expect(again.json().options).toMatchObject({ retryOf: id, structure: { mode: "test" } });
    await publishCandidate(B, again.json().id);
    expect(q.scalar<number>("SELECT COUNT(*) FROM ad WHERE biz_id = ?", B)).toBe(9);
  });

  it("không cho chọn trùng một bài trong CÙNG 1 lần tạo", async () => {
    expect((await api("/v1/ads/quick", { ...base(), posts: [post(1), post(1)] })).statusCode).toBe(400);
  });

  it("1 bài chạy được ở nhiều chiến dịch / nhiều nhóm khác nhau; bài vẫn 'đang chạy' khi chiến dịch mới tạo ở trạng thái tạm dừng", async () => {
    const first = await api("/v1/ads/quick", { ...base(), posts: [post(1), post(2)], startPaused: false });
    await publishCandidate(B, first.json().id);
    const again = await api("/v1/ads/quick", { ...base(), posts: [post(2), post(3)], adsets: [{}, {}], startPaused: true });
    expect(again.statusCode).toBe(200);
    await publishCandidate(B, again.json().id);
    expect(byId<Row>("ad_candidate", again.json().id)!.status).toBe("published");
    expect(q.scalar<number>("SELECT COUNT(*) FROM campaign WHERE biz_id = ?", B)).toBe(2);
    const p2 = q.get<Row>("SELECT * FROM post WHERE external_id = 'P1_2'")!;
    // bài 2: 1 quảng cáo ở chiến dịch 1 + 2 quảng cáo (2 nhóm) ở chiến dịch 2
    expect(q.scalar<number>("SELECT COUNT(*) FROM ad WHERE post_id = ?", p2.id)).toBe(3);
    expect(p2.ad_status).toBe("running");
    // bài đơn lẻ (kiểu cũ) cũng chạy lại được
    const single = await api("/v1/ads/quick", { ...base(), post: post(1) });
    expect(single.statusCode).toBe(200);
    await publishCandidate(B, single.json().id);
    expect(byId<Row>("ad_candidate", single.json().id)!.status).toBe("published");
  });
});
