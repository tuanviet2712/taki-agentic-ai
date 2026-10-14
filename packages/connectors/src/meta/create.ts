import { ConnectorError } from "../errors.ts";
import { graphDelete, graphGet, graphPost } from "./graph.ts";
import { OBJECTIVE, missingRequirement, promotedObject, type AdObjective } from "./objectives.ts";
import { buildTargeting, type TargetingSpec } from "./targeting.ts";

/**
 * Boost an existing Page post — ported from TakiAcademy-AI/ads-os (lib/ads/facebook-create.ts), the chain that was
 * run end-to-end on real accounts. campaign → adset → creative → ad, ALL created PAUSED; a failing step returns
 * what was created so the caller can clean up (cleanupPartial). Activation, when the user asked to start
 * immediately, is a separate explicit step after the whole chain exists (activateBoost).
 */
export interface BoostSpec {
  adAccountId: string;
  pageId: string;
  /** '<page_id>_<post_id>' exactly as Graph returns it. */
  postId: string;
  campaignName: string;
  /** Major units of the account currency (VND = đồng). */
  dailyBudget: number;
  /** Multiplier to the minor unit Facebook expects (1 for VND, 100 for USD). */
  minorFactor: number;
  targeting: TargetingSpec;
  objective: AdObjective;
  pixelId?: string | null;
  conversionEvent?: string | null;
}
export interface CreatedAd { campaignId: string; adsetId: string; creativeId: string; adId: string }

export class AdCreateError extends ConnectorError {
  constructor(base: ConnectorError, readonly step: "campaign" | "adset" | "creative" | "ad", readonly created: Partial<CreatedAd>) {
    super(base.kind, `${base.message} (bước ${STEP_VI[step]})`);
  }
}
const STEP_VI = { campaign: "tạo chiến dịch", adset: "tạo nhóm quảng cáo", creative: "tạo nội dung", ad: "tạo quảng cáo" } as const;

const act = (s: BoostSpec) => (s.adAccountId.startsWith("act_") ? s.adAccountId : `act_${s.adAccountId}`);
export const storyIdOf = (pageId: string, postId: string) => (postId.includes("_") ? postId : `${pageId}_${postId}`);

function campaignBody(s: BoostSpec): Record<string, unknown> {
  return {
    name: s.campaignName,
    objective: OBJECTIVE[s.objective].fbObjective,
    status: "PAUSED",
    special_ad_categories: "[]",
    // Budget lives on the adset (ABO); false = Facebook may not drift from the amount the user set.
    is_adset_budget_sharing_enabled: "false",
  };
}

async function step<T>(created: Partial<CreatedAd>, name: AdCreateError["step"], fn: () => Promise<T>): Promise<T> {
  try {
    const r: any = await fn();
    if (!r?.id) throw new ConnectorError("InvalidRequest", "Meta: phản hồi không có id");
    return r;
  } catch (e) {
    throw new AdCreateError(e instanceof ConnectorError ? e : new ConnectorError("InvalidRequest", String(e)), name, created);
  }
}

/**
 * Checks the campaign payload WITHOUT creating anything (execution_options=validate_only). Catches what usually
 * breaks at the account level (blocked ad creation, broken token, 31/3858385) — not a guarantee for the whole
 * chain, since the adset/ad checks need real parent ids.
 */
export async function validateBoost(token: string, s: BoostSpec): Promise<void> {
  const missing = missingRequirement(s.objective, s);
  if (missing) throw new ConnectorError("InvalidRequest", missing);
  await graphPost(token, `${act(s)}/campaigns`, { ...campaignBody(s), execution_options: '["validate_only"]' });
}

export async function createBoost(token: string, s: BoostSpec): Promise<CreatedAd> {
  const created: Partial<CreatedAd> = {};
  const obj = OBJECTIVE[s.objective];
  // Block BEFORE any call: a Chuyển đổi template without pixel would fail at the adset step, after the campaign exists.
  const missing = missingRequirement(s.objective, s);
  if (missing) throw new AdCreateError(new ConnectorError("InvalidRequest", missing), "campaign", created);
  const budget = Math.round(s.dailyBudget * s.minorFactor);
  if (!(budget > 0)) throw new AdCreateError(new ConnectorError("InvalidRequest", "Ngân sách ngày phải lớn hơn 0"), "campaign", created);

  const campaign = await step(created, "campaign", () => graphPost(token, `${act(s)}/campaigns`, campaignBody(s)));
  created.campaignId = String(campaign.id);

  const promoted = promotedObject(s.objective, s);
  const adset = await step(created, "adset", () => graphPost(token, `${act(s)}/adsets`, {
    name: `${s.campaignName} — nhóm 1`,
    campaign_id: created.campaignId,
    daily_budget: String(budget),
    billing_event: "IMPRESSIONS",
    optimization_goal: obj.optimizationGoal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    // REQUIRED and the hardest to find: without it OUTCOME_ENGAGEMENT is read as website conversions and the AD
    // step fails asking for a pixel.
    destination_type: obj.destinationType,
    // Left out entirely when the objective must not carry it (POST_ENGAGEMENT + promoted_object is rejected).
    ...(promoted ? { promoted_object: JSON.stringify(promoted) } : {}),
    targeting: JSON.stringify(buildTargeting(s.targeting)),
    status: "PAUSED",
  }));
  created.adsetId = String(adset.id);

  const creative = await step(created, "creative", () => graphPost(token, `${act(s)}/adcreatives`, {
    name: `${s.campaignName} — creative`,
    object_story_id: storyIdOf(s.pageId, s.postId),
    // Tin nhắn needs the message button, otherwise the AD step fails with 100/1487891.
    ...(obj.callToAction ? { call_to_action: JSON.stringify(obj.callToAction) } : {}),
  }));
  created.creativeId = String(creative.id);

  const ad = await step(created, "ad", () => graphPost(token, `${act(s)}/ads`, {
    name: `${s.campaignName} — ad`,
    adset_id: created.adsetId,
    creative: JSON.stringify({ creative_id: created.creativeId }),
    status: "PAUSED",
  }));
  return { campaignId: created.campaignId, adsetId: created.adsetId, creativeId: created.creativeId, adId: String(ad.id) };
}

// ---------------- Test structure: 1 campaign → N adsets → M ads (one per post) ----------------
/**
 * One campaign holding several adsets, each running the same set of posts as separate ads — the "1:3:3" test
 * layout (1 campaign, 3 audiences, 3 creatives). Same rules as createBoost: everything PAUSED, ABO (budget on each
 * adset), one creative per post reused by every adset, and a failure reports what exists so it can be removed.
 */
export interface StructureSpec {
  adAccountId: string;
  pageId: string;
  campaignName: string;
  minorFactor: number;
  objective: AdObjective;
  pixelId?: string | null;
  conversionEvent?: string | null;
  /** '<page_id>_<post_id>' per post, in the order the ads are named. */
  postIds: string[];
  adsets: { name?: string; dailyBudget: number; targeting: TargetingSpec }[];
}
export interface CreatedStructure {
  campaignId: string;
  creativeIds: string[];
  adsets: { adsetId: string; dailyBudget: number; ads: { adId: string; postId: string; creativeId: string }[] }[];
}
export type PartialStructure = { campaignId?: string; creativeIds: string[] };

export class StructureCreateError extends ConnectorError {
  constructor(base: ConnectorError, readonly step: AdCreateError["step"], readonly created: PartialStructure) {
    super(base.kind, `${base.message} (bước ${STEP_VI[step]})`);
  }
}

async function structureStep<T>(created: PartialStructure, name: AdCreateError["step"], fn: () => Promise<T>): Promise<T> {
  try {
    const r: any = await fn();
    if (!r?.id) throw new ConnectorError("InvalidRequest", "Meta: phản hồi không có id");
    return r;
  } catch (e) {
    throw new StructureCreateError(e instanceof ConnectorError ? e : new ConnectorError("InvalidRequest", String(e)), name, created);
  }
}

export async function createCampaignStructure(token: string, s: StructureSpec): Promise<CreatedStructure> {
  const created: PartialStructure = { creativeIds: [] };
  const obj = OBJECTIVE[s.objective];
  const fail = (msg: string) => new StructureCreateError(new ConnectorError("InvalidRequest", msg), "campaign", created);
  const missing = missingRequirement(s.objective, s);
  if (missing) throw fail(missing);
  if (!s.postIds.length) throw fail("Chưa chọn bài viết nào");
  if (!s.adsets.length) throw fail("Cần ít nhất 1 nhóm quảng cáo");
  const budgets = s.adsets.map((a) => Math.round(a.dailyBudget * s.minorFactor));
  if (budgets.some((b) => !(b > 0))) throw fail("Ngân sách ngày của mỗi nhóm phải lớn hơn 0");

  const shape: BoostSpec = { adAccountId: s.adAccountId, pageId: s.pageId, postId: s.postIds[0], campaignName: s.campaignName, dailyBudget: 0, minorFactor: s.minorFactor, targeting: s.adsets[0].targeting, objective: s.objective, pixelId: s.pixelId, conversionEvent: s.conversionEvent };
  const campaign = await structureStep(created, "campaign", () => graphPost(token, `${act(shape)}/campaigns`, campaignBody(shape)));
  created.campaignId = String(campaign.id);

  // One creative per post, shared by every adset (a creative can back many ads).
  for (const [j, postId] of s.postIds.entries()) {
    const creative = await structureStep(created, "creative", () => graphPost(token, `${act(shape)}/adcreatives`, {
      name: `${s.campaignName} — bài ${j + 1}`,
      object_story_id: storyIdOf(s.pageId, postId),
      ...(obj.callToAction ? { call_to_action: JSON.stringify(obj.callToAction) } : {}),
    }));
    created.creativeIds.push(String(creative.id));
  }

  const promoted = promotedObject(s.objective, shape);
  const adsets: CreatedStructure["adsets"] = [];
  for (const [i, a] of s.adsets.entries()) {
    const adsetName = a.name?.trim() || `${s.campaignName} — nhóm ${i + 1}`;
    const adset = await structureStep(created, "adset", () => graphPost(token, `${act(shape)}/adsets`, {
      name: adsetName,
      campaign_id: created.campaignId,
      daily_budget: String(budgets[i]),
      billing_event: "IMPRESSIONS",
      optimization_goal: obj.optimizationGoal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: obj.destinationType,
      ...(promoted ? { promoted_object: JSON.stringify(promoted) } : {}),
      targeting: JSON.stringify(buildTargeting(a.targeting)),
      status: "PAUSED",
    }));
    const ads: CreatedStructure["adsets"][number]["ads"] = [];
    for (const [j, postId] of s.postIds.entries()) {
      const ad = await structureStep(created, "ad", () => graphPost(token, `${act(shape)}/ads`, {
        name: `${adsetName} — bài ${j + 1}`,
        adset_id: String(adset.id),
        creative: JSON.stringify({ creative_id: created.creativeIds[j] }),
        status: "PAUSED",
      }));
      ads.push({ adId: String(ad.id), postId, creativeId: created.creativeIds[j] });
    }
    adsets.push({ adsetId: String(adset.id), dailyBudget: a.dailyBudget, ads });
  }
  return { campaignId: created.campaignId, creativeIds: created.creativeIds, adsets };
}

/** Remove a partly created structure: the campaign (takes adsets + ads) and every creative (account-level). */
export async function cleanupStructure(token: string, created: PartialStructure): Promise<void> {
  if (created.campaignId) await graphDelete(token, created.campaignId);
  for (const id of created.creativeIds) await graphDelete(token, id);
}

/** Switch a paused structure on: ads → adsets → campaign; returns the campaign status read back. */
export async function activateStructure(token: string, c: CreatedStructure): Promise<string | null> {
  for (const a of c.adsets) for (const ad of a.ads) await graphPost(token, ad.adId, { status: "ACTIVE" });
  for (const a of c.adsets) await graphPost(token, a.adsetId, { status: "ACTIVE" });
  await graphPost(token, c.campaignId, { status: "ACTIVE" });
  return readStatus(token, c.campaignId);
}

/**
 * Remove what a failed chain created. Deleting the campaign takes the adset/ad with it but NOT the creative
 * (account-level object), so that one is deleted separately — otherwise every failure leaves an orphan.
 */
export async function cleanupPartial(token: string, created: Partial<CreatedAd>): Promise<void> {
  if (created.campaignId) await graphDelete(token, created.campaignId);
  if (created.creativeId) await graphDelete(token, created.creativeId);
}

/** Switch a freshly created (paused) chain on: ad → adset → campaign, then read the ad back. */
export async function activateBoost(token: string, c: CreatedAd): Promise<string | null> {
  for (const id of [c.adId, c.adsetId, c.campaignId]) await graphPost(token, id, { status: "ACTIVE" });
  return readStatus(token, c.adId);
}

/** Read back after a write — trust the data, not the write response. */
export async function readStatus(token: string, id: string): Promise<string | null> {
  try { return ((await graphGet(token, id, { fields: "status" })).status as string) ?? null; } catch { return null; }
}
export async function readDailyBudget(token: string, id: string): Promise<number | null> {
  try { const r = await graphGet(token, id, { fields: "daily_budget" }); return r.daily_budget != null ? Number(r.daily_budget) : null; } catch { return null; }
}
