import type { Handler } from "../queue.ts";
import { campaignTick } from "./campaigns.ts";
import { reputationScan } from "./events.ts";
import { generateAllSteps, sequenceTick } from "./sequences.ts";
import { ensureSystemTemplates } from "./templates.ts";

/** Kênh Email (gửi qua Resend) — xem PLAN-EMAIL.md. */
export * from "./contacts.ts";
export * from "./settings.ts";
export * from "./send.ts";
export * from "./events.ts";
export * from "./segments.ts";
export * from "./campaigns.ts";
export * from "./sequences.ts";
export * from "./templates.ts";
export * from "./domain.ts";
export * from "./hooks.ts";
export * from "./stats.ts";

export const EMAIL_HANDLERS: Record<string, Handler> = {
  // 1 phút/lần: chiến dịch đến giờ + thư chuỗi đến hạn (trong khung giờ gửi, theo hạn mức warm-up).
  "email.tick": async (p) => {
    ensureSystemTemplates(p.bizId);
    await campaignTick(p.bizId);
    await sequenceTick(p.bizId);
  },
  "email.reputation": async (p) => void reputationScan(p.bizId),
  "email.generate": async (p, job) => void (await generateAllSteps(job.biz_id, p.sequenceId, p.actor ?? "email")),
};
