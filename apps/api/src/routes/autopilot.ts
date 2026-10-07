import type { FastifyInstance } from "fastify";
import { activeDna, bizSettings, isKilled, q, type Row } from "@dotaka/db";
import { effectiveProvider } from "@dotaka/llm-gateway";
import {
  AUTOPILOT_PLATFORMS, PLATFORM_NAME, autopilotAllocation, autopilotNextTick, autopilotPipeline, autopilotSettings, autopilotState, autopilotTick,
  assertAutopilotEnabled, dnaProducts, pipelineCoverage, publishRoute, rotationProducts, routeReason, saveAutopilotSettings, setAutopilotEnabled,
  telegramAssistantStatus, videoAiStatus, type AutopilotSettings,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

/**
 * Trang "Lái tự động": cấu hình 1 lần → hệ thống tự giữ đủ nội dung (packages/orchestrator/src/autopilot.ts).
 * Bật khi còn điều kiện bắt buộc chưa xong → 400 kèm danh sách việc cần làm (tiếng Việt, có link sửa).
 */
export type PrereqItem = { key: string; title: string; status: "ok" | "warn" | "fail"; detail: string; action?: { label: string; href: string } };
const REQUIRED_AGENTS: [string, string][] = [["brief", "Chuẩn hóa brief"], ["strategy", "Kế hoạch nội dung"], ["content", "Viết bài"], ["video_script", "Kịch bản video"]];

/** Điều kiện để lái tự động chạy THẬT. fail = chặn bật; warn = chạy được nhưng thiếu một phần. Chỉ đọc. */
export async function autopilotPrerequisites(bizId: string, s: AutopilotSettings = autopilotSettings(bizId)): Promise<PrereqItem[]> {
  const out: PrereqItem[] = [];
  const add = (i: PrereqItem) => out.push(i);

  const llm = effectiveProvider(bizId);
  add(llm.provider === "sandbox"
    ? { key: "llm", title: "Claude (bộ não AI) chạy thật", status: "fail", detail: llm.reason ?? "Đang ở chế độ mô phỏng — nội dung sẽ không phải bài thật", action: { label: "Mở Cài đặt", href: "/settings" } }
    : { key: "llm", title: "Claude (bộ não AI) chạy thật", status: "ok", detail: "Tài khoản Claude (Claude Code CLI)" });

  const dna = activeDna(bizId);
  add(dna ? { key: "dna", title: "DNA thương hiệu", status: "ok", detail: `Phiên bản ${dna.version} đang hiệu lực` }
    : { key: "dna", title: "DNA thương hiệu", status: "fail", detail: "Chưa có DNA đang hiệu lực", action: { label: "Nạp DNA", href: "/dna" } });

  const all = dnaProducts(bizId);
  const rot = rotationProducts(bizId, s);
  const missing = s.products.filter((k) => !rot.some((p) => p.key === k));
  add(!rot.length
    ? { key: "products", title: "Khóa học / sản phẩm để xoay vòng", status: "fail", detail: all.length ? "Các khóa học đã chọn không còn trong DNA" : "DNA chưa có khóa học / sản phẩm nào", action: { label: "Thêm vào DNA", href: "/dna" } }
    : missing.length
      ? { key: "products", title: "Khóa học / sản phẩm để xoay vòng", status: "warn", detail: `${rot.length} khóa sẵn sàng · ${missing.length} khóa đã chọn không còn trong DNA — sẽ bỏ qua` }
      : { key: "products", title: "Khóa học / sản phẩm để xoay vòng", status: "ok", detail: rot.map((p) => p.name).join(", ") });

  // Kênh đăng chính của từng nền tảng: đăng được thật (API) hoặc Chrome đã sẵn sàng — không bao giờ mô phỏng.
  if (!s.platforms.length) add({ key: "platforms", title: "Nền tảng đăng", status: "fail", detail: "Chưa chọn nền tảng nào", action: { label: "Chọn nền tảng bên dưới", href: "/autopilot#settings" } });
  for (const { platform } of s.platforms) {
    const name = PLATFORM_NAME[platform];
    const ch = q.get<Row>("SELECT * FROM channel WHERE biz_id = ? AND platform = ? AND enabled = 1 ORDER BY created_at LIMIT 1", bizId, platform);
    if (!ch) { add({ key: `channel_${platform}`, title: `Kênh đăng ${name}`, status: "fail", detail: `Chưa có kênh ${name} nào để đăng`, action: { label: "Thêm kênh đăng", href: "/channels" } }); continue; }
    const route = publishRoute(ch);
    add(route === "none"
      ? { key: `channel_${platform}`, title: `Kênh đăng ${name}`, status: "fail", detail: `${ch.name}: ${routeReason(ch)} — bài duyệt xong sẽ không lên ${name} thật`, action: { label: "Thiết lập kênh đăng", href: "/channels" } }
      : { key: `channel_${platform}`, title: `Kênh đăng ${name}`, status: "ok", detail: `${ch.name} — ${routeReason(ch)}` });
  }

  const off = REQUIRED_AGENTS.filter(([k]) => !q.get<Row>("SELECT enabled FROM agent_config WHERE biz_id = ? AND agent_key = ? AND enabled = 1", bizId, k));
  add(off.length
    ? { key: "agents", title: "Agent của chuỗi nội dung", status: "fail", detail: `Đang tắt: ${off.map(([, l]) => l).join(", ")}`, action: { label: "Bật agent", href: "/agents" } }
    : { key: "agents", title: "Agent của chuỗi nội dung", status: "ok", detail: "Brief, kế hoạch, viết bài, kịch bản đều bật" });

  add(isKilled(bizId, "publish")
    ? { key: "kill_switch", title: "Dừng khẩn cấp đăng bài", status: "fail", detail: "Đang DỪNG đăng bài — mở lại trước khi bật lái tự động", action: { label: "Mở Cài đặt", href: "/settings" } }
    : { key: "kill_switch", title: "Dừng khẩn cấp đăng bài", status: "ok", detail: "Không dừng" });

  add(s.approvalGate
    ? { key: "gate", title: "Cổng duyệt đăng", status: "ok", detail: "Mọi bài / kịch bản của lái tự động chờ Sếp duyệt trước khi đăng" }
    : { key: "gate", title: "Cổng duyệt đăng", status: "warn", detail: "Đã tắt — bài đạt chấm điểm có thể tự đăng theo mức tự chủ của agent viết bài", action: { label: "Bật lại bên dưới", href: "/autopilot#settings" } });

  const cap = bizSettings(bizId).caps.maxPostsPerDayPerChannel;
  const over = s.platforms.filter((p) => p.postsPerDay > cap);
  if (over.length) add({ key: "cap", title: "Giới hạn bài mỗi ngày", status: "warn", detail: `Cài đặt chỉ cho đăng tối đa ${cap} bài/ngày/kênh — ${over.map((p) => PLATFORM_NAME[p.platform]).join(", ")} chọn nhiều hơn sẽ dời sang hôm sau`, action: { label: "Đổi giới hạn", href: "/settings" } });

  if (s.platforms.some((p) => p.platform === "tiktok") && s.videoMode === "none")
    add({ key: "tiktok_video", title: "TikTok cần video", status: "warn", detail: "TikTok chỉ đăng video — kịch bản TikTok sẽ chờ Sếp tự làm video", action: { label: "Đổi chế độ video", href: "/autopilot#settings" } });
  if (s.videoMode === "free_auto") {
    const mp = videoAiStatus().moneyprinter;
    add(!mp.installed
      ? { key: "video", title: "Video tự động (miễn phí)", status: "warn", detail: "Chưa cài máy dựng Video tự động — kịch bản sẽ chờ Sếp bấm làm video", action: { label: "Mở Sản xuất video", href: "/video-flow" } }
      : !mp.pexels.length && !mp.pixabay.length
        ? { key: "video", title: "Video tự động (miễn phí)", status: "warn", detail: "Thiếu khóa Pexels/Pixabay (miễn phí) — Sếp nhập ở Sản xuất video → Công cụ video AI", action: { label: "Mở Sản xuất video", href: "/video-flow" } }
        : { key: "video", title: "Video tự động (miễn phí)", status: "ok", detail: "Sẵn sàng · kịch bản cần người thật / Flow vẫn chờ Sếp bấm (tốn tín dụng)" });
  }
  if (s.notifyTelegram) {
    const tg = await telegramAssistantStatus(bizId).catch(() => null) as Row | null;
    const paired = (tg?.chats ?? []).length;
    add(paired ? { key: "telegram", title: "Báo qua Telegram (Ngân Nguyệt)", status: "ok", detail: `${paired} chat đã ghép nối` }
      : { key: "telegram", title: "Báo qua Telegram (Ngân Nguyệt)", status: "warn", detail: "Chưa ghép nối chat Telegram — sẽ chỉ báo trên web", action: { label: "Ghép nối ở Cài đặt", href: "/settings" } });
  }
  return out;
}

export function autopilotRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/autopilot", ({ bizId }) => {
    const settings = autopilotSettings(bizId);
    return {
      settings, state: autopilotState(bizId), nextTickAt: settings.enabled ? autopilotNextTick(bizId) : null,
      platforms: AUTOPILOT_PLATFORMS,
      coverage: Object.fromEntries(settings.platforms.map((p) => [p.platform, pipelineCoverage(bizId, p.platform, settings)])),
      products: dnaProducts(bizId).map((p) => ({ key: p.key, name: p.name, price: p.price ?? null, verified: Boolean(p.verified) })),
      pipeline: autopilotPipeline(bizId),
      allocation: autopilotAllocation(bizId, settings),
      recent: q.all<Row>(`SELECT g.id, g.title, g.status, g.created_at, json_extract(g.params, '$.autopilot.platform') platform,
          (SELECT COUNT(*) FROM content_item ci WHERE ci.goal_id = g.id) items,
          (SELECT COUNT(*) FROM post p JOIN content_item ci ON ci.id = p.content_item_id WHERE ci.goal_id = g.id AND COALESCE(p.simulated, 0) = 0) posts
        FROM goal g WHERE g.biz_id = ? AND json_extract(g.params, '$.autopilot.key') IS NOT NULL ORDER BY g.created_at DESC LIMIT 8`, bizId),
    };
  });
  r.get("/v1/autopilot/prerequisites", async ({ bizId }) => {
    const items = await autopilotPrerequisites(bizId);
    return { items, blockers: items.filter((i) => i.status === "fail").length };
  });
  r.put("/v1/autopilot/settings", ({ bizId, body, actor }) => saveAutopilotSettings(bizId, body, actor));
  r.post("/v1/autopilot/enable", async ({ bizId, actor }) => {
    const items = await autopilotPrerequisites(bizId);
    const blockers = items.filter((i) => i.status === "fail");
    if (blockers.length)
      throw new AppError("AUTOPILOT_BLOCKED", `Chưa bật được lái tự động — còn ${blockers.length} việc cần làm: ${blockers.map((b) => `${b.title} (${b.detail})`).join("; ")}`, 400, { blockers });
    const settings = setAutopilotEnabled(bizId, true, actor);
    const run = await autopilotTick(bizId, { manual: true, actor });
    return { settings, run, warnings: items.filter((i) => i.status === "warn") };
  });
  r.post("/v1/autopilot/pause", ({ bizId, actor }) => ({ settings: setAutopilotEnabled(bizId, false, actor) }));
  r.post("/v1/autopilot/run", async ({ bizId, actor }) => {
    assertAutopilotEnabled(bizId);
    return { run: await autopilotTick(bizId, { manual: true, actor }) };
  });
}
