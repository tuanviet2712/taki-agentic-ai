import type { FastifyInstance } from "fastify";
import {
  autoCreateGoogleCampaign, checkGoogleCampaign, createGoogleCampaign, googleCampaignOptions, planGoogleCampaign, recentGoogleCampaigns,
} from "@dotaka/orchestrator";
import { routes } from "../http.ts";

/**
 * Google Ads: tạo chiến dịch Search theo mục tiêu.
 *  - /options  mục tiêu, sản phẩm trong DNA
 *  - /plan     AI soạn từ khóa / tiêu đề / mô tả theo mục tiêu (chưa tạo gì)
 *  - /check    Google kiểm toàn bộ chuỗi (chưa tạo gì)
 *  - /campaign tạo chiến dịch từ nội dung đã soạn / chỉnh
 *  - /auto     một lệnh: soạn theo mục tiêu rồi tạo luôn
 */
export function googleAdsRoutes(app: FastifyInstance) {
  const r = routes(app);
  r.get("/v1/ads/google/options", ({ bizId }) => googleCampaignOptions(bizId));
  r.get("/v1/ads/google/recent", ({ bizId }) => recentGoogleCampaigns(bizId));
  r.post("/v1/ads/google/plan", ({ bizId, body }) => planGoogleCampaign(bizId, body));
  r.post("/v1/ads/google/check", ({ bizId, body }) => checkGoogleCampaign(bizId, body));
  r.post("/v1/ads/google/campaign", ({ bizId, body, actor }) => createGoogleCampaign(bizId, body, actor));
  r.post("/v1/ads/google/auto", ({ bizId, body, actor }) => autoCreateGoogleCampaign(bizId, body, actor));
}
