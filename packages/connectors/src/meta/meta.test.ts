import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../errors.ts";
import { countConversions, CONVERSION_ACTIONS, mapObjective } from "./conversions.ts";
import { createBoost, createCampaignStructure, type BoostSpec } from "./create.ts";
import { graphPost } from "./graph.ts";
import { missingRequirement, promotedObject } from "./objectives.ts";
import { assessPosts, externalLinkOf } from "./posts.ts";
import { buildTargeting, templateTargeting } from "./targeting.ts";

describe("buildTargeting (ads-os)", () => {
  const base = { countries: ["VN"], locations: [], ageMin: 28, ageMax: 55, genders: [], interests: [], placements: { automatic: true }, advantageAudience: true };
  it("Advantage+ on: age_max 65, age_min ≤ 25, real range as age_range, individual_setting (fix 1870189)", () => {
    const t = buildTargeting(base);
    expect(t).toMatchObject({ age_min: 25, age_max: 65, age_range: [28, 55], targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, gender: 1 } } });
  });
  it("Advantage+ off sends hard ages and advantage_audience 0", () => {
    expect(buildTargeting({ ...base, advantageAudience: false })).toMatchObject({ age_min: 28, age_max: 55, targeting_automation: { advantage_audience: 0 } });
  });
  it("cities replace countries; no empty arrays are ever sent", () => {
    const t: any = buildTargeting({ ...base, locations: [{ type: "city", key: "2347", name: "Hà Nội" }], genders: [] });
    expect(t.geo_locations).toEqual({ cities: [{ key: "2347" }] });
    expect(t.genders).toBeUndefined();
    expect(t.publisher_platforms).toBeUndefined();
  });
  it("manual placements fill messenger / audience network positions", () => {
    const t: any = buildTargeting({ ...base, placements: { automatic: false, publisherPlatforms: ["facebook", "messenger", "audience_network"], facebookPositions: ["feed"] } });
    expect(t.messenger_positions).toEqual(["messenger_home"]);
    expect(t.audience_network_positions).toEqual(["classic"]);
  });
  it("maps existing templates: string interests are notes only, both genders = all", () => {
    const s = templateTargeting({ audience: { locations: ["vn"], ageMin: 28, ageMax: 55, genders: [1, 2], interests: ["CEO", { id: "600", name: "Startup" }] } });
    expect(s).toMatchObject({ countries: ["VN"], genders: [], interests: [{ id: "600", name: "Startup" }], advantageAudience: true });
  });
});

describe("objectives (ads-os)", () => {
  it("engagement never sends promoted_object; messages sends page; sales needs pixel + event", () => {
    expect(promotedObject("engagement", { pageId: "p" })).toBeNull();
    expect(promotedObject("messages", { pageId: "p" })).toEqual({ page_id: "p" });
    expect(missingRequirement("sales", {})).toMatch(/pixel/);
    expect(missingRequirement("sales", { pixelId: "1", conversionEvent: "LEAD" })).toMatch(/không dùng được/);
    expect(missingRequirement("sales", { pixelId: "1", conversionEvent: "PURCHASE" })).toBeNull();
  });
});

describe("conversions (ads-os)", () => {
  it("takes the first action type by priority, never sums, never falls back to clicks", () => {
    const actions = [{ action_type: "omni_purchase", value: "3" }, { action_type: "purchase", value: "3" }, { action_type: "link_click", value: "90" }];
    expect(countConversions(actions, CONVERSION_ACTIONS.sales)).toEqual({ count: 3, actionType: "purchase" });
    expect(countConversions([{ action_type: "link_click", value: "90" }], CONVERSION_ACTIONS.sales)).toEqual({ count: 0, actionType: null });
    expect(mapObjective("OUTCOME_ENGAGEMENT")).toBe("engagement");
    expect(mapObjective("MESSAGES")).toBe("messages");
  });
});

describe("post fitness (ads-os)", () => {
  const post = (id: string, r: number, c: number, s: number, url: string | null = null) => ({ id, message: "x", createdTime: "2026-10-01", permalink: null, image: null, statusType: null, mediaType: "photo", attachmentUrl: url, reactions: r, comments: c, shares: s });
  it("sales is blocked without an external link; comments signal messaging intent", () => {
    const { posts, note } = assessPosts([post("a", 2, 5, 0), post("b", 1, 0, 0, "https://taki.vn/khoa-hoc"), post("c", 0, 0, 0)]);
    expect(posts[0].fitness.byObjective.sales.verdict).toBe("blocked");
    expect(posts[0].fitness.byObjective.messages.verdict).toBe("good");
    expect(posts[1].fitness.byObjective.sales.verdict).toBe("good");
    expect(posts[2].fitness.byObjective.engagement.verdict).toBe("warn");
    expect(note).toMatch(/rất thấp/);
    expect(externalLinkOf("https://www.facebook.com/reel/1")).toBeNull();
  });
});

describe("Graph transport + boost chain (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("treats HTTP 200 + error block as a failure and explains 31/3858385 (System User)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { message: "Please authenticate", code: 31, error_subcode: 3858385 } })));
    const err = await graphPost("t", "act_1/campaigns", { name: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.kind).toBe("PolicyRejected");
    expect(err.message).toMatch(/System User/);
  });

  it("a write that gets no answer is 'outcome unknown' (never auto-resent); a refused connection is 'not sent' (safe to retry)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }));
    const timedOut = await graphPost("t", "PAGE/messages", { message: "x" }).catch((e) => e);
    expect(timedOut).toBeInstanceOf(ConnectorError);
    expect(timedOut.kind).toBe("InvalidRequest"); // kind unchanged: the queue still does not auto-retry writes
    expect(timedOut.outcomeUnknown).toBe(true);
    expect(timedOut.requestNotSent).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }));
    const refused = await graphPost("t", "PAGE/messages", { message: "x" }).catch((e) => e);
    expect(refused.requestNotSent).toBe(true);
    expect(refused.outcomeUnknown).toBeUndefined();
    // A real answer (HTTP error) is neither
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { message: "(#10) Permission", code: 10 } }, 403)));
    const denied = await graphPost("t", "PAGE/messages", { message: "x" }).catch((e) => e);
    expect(denied.outcomeUnknown).toBeUndefined();
    expect(denied.requestNotSent).toBeUndefined();
  });

  it("sends the token in the Authorization header, never in the URL", async () => {
    const f = vi.fn(async () => reply({ id: "1" }));
    vi.stubGlobal("fetch", f);
    await graphPost("SECRET", "act_1/campaigns", { name: "x" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toMatch(/SECRET/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRET");
  });

  const spec: BoostSpec = {
    adAccountId: "act_9", pageId: "100", postId: "100_200", campaignName: "Test", dailyBudget: 200_000, minorFactor: 1,
    targeting: templateTargeting({}), objective: "messages",
  };
  it("creates campaign → adset → creative → ad, all PAUSED, with MESSAGE_PAGE for Tin nhắn", async () => {
    const bodies: Record<string, URLSearchParams> = {};
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      bodies[String(url).split("/").pop()!] = init.body as URLSearchParams;
      return reply({ id: String(++n) });
    }));
    const c = await createBoost("t", spec);
    expect(c).toEqual({ campaignId: "1", adsetId: "2", creativeId: "3", adId: "4" });
    expect(bodies.campaigns.get("status")).toBe("PAUSED");
    expect(bodies.adsets.get("destination_type")).toBe("MESSENGER");
    expect(JSON.parse(bodies.adsets.get("promoted_object")!)).toEqual({ page_id: "100" });
    expect(bodies.adsets.get("daily_budget")).toBe("200000");
    expect(JSON.parse(bodies.adcreatives.get("call_to_action")!).type).toBe("MESSAGE_PAGE");
    expect(bodies.ads.get("status")).toBe("PAUSED");
  });

  it("engagement leaves promoted_object out; a failing step reports what was created for cleanup", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/adsets")) expect((init.body as URLSearchParams).has("promoted_object")).toBe(false);
      if (String(url).endsWith("/adcreatives")) return reply({ error: { message: "bad", code: 100 } }, 400);
      return reply({ id: String(++n) });
    }));
    const err: any = await createBoost("t", { ...spec, objective: "engagement" }).catch((e) => e);
    expect(err.step).toBe("creative");
    expect(err.created).toEqual({ campaignId: "1", adsetId: "2" });
  });

  it("1:3:3 structure: 1 campaign, 3 creatives (one per post, shared), 3 adsets each with 3 ads — all PAUSED", async () => {
    const calls: { edge: string; body: URLSearchParams }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ edge: String(url).split("/").pop()!, body: init.body as URLSearchParams });
      return reply({ id: String(++n) });
    }));
    const audience = templateTargeting({});
    const c = await createCampaignStructure("t", {
      adAccountId: "act_9", pageId: "100", campaignName: "Test", minorFactor: 1, objective: "messages",
      postIds: ["100_1", "100_2", "100_3"], adsets: [0, 1, 2].map(() => ({ dailyBudget: 300_000, targeting: audience })),
    });
    const count = (edge: string) => calls.filter((x) => x.edge === edge).length;
    expect([count("campaigns"), count("adcreatives"), count("adsets"), count("ads")]).toEqual([1, 3, 3, 9]);
    expect(c.creativeIds).toHaveLength(3);
    expect(c.adsets.map((a) => a.ads.length)).toEqual([3, 3, 3]);
    // every adset reuses the same 3 creatives, in post order
    expect(c.adsets.every((a) => a.ads.map((ad) => ad.creativeId).join() === c.creativeIds.join())).toBe(true);
    expect(calls.filter((x) => x.edge === "adsets").every((x) => x.body.get("daily_budget") === "300000" && x.body.get("status") === "PAUSED")).toBe(true);
    expect(calls.filter((x) => x.edge === "ads").every((x) => x.body.get("status") === "PAUSED")).toBe(true);
  });

  it("structure: a failing adset reports the campaign + every creative so all of it is cleaned up", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/adsets")) return reply({ error: { message: "bad", code: 100 } }, 400);
      return reply({ id: String(++n) });
    }));
    const err: any = await createCampaignStructure("t", {
      adAccountId: "act_9", pageId: "100", campaignName: "Test", minorFactor: 1, objective: "messages",
      postIds: ["100_1", "100_2"], adsets: [{ dailyBudget: 100_000, targeting: templateTargeting({}) }],
    }).catch((e) => e);
    expect(err.step).toBe("adset");
    expect(err.created).toEqual({ campaignId: "1", creativeIds: ["2", "3"] });
  });

  it("blocks a Chuyển đổi template without pixel BEFORE calling Facebook", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const err = await createBoost("t", { ...spec, objective: "sales" }).catch((e) => e);
    expect(err.message).toMatch(/pixel/);
    expect(f).not.toHaveBeenCalled();
  });
});
