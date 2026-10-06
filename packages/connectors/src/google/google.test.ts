import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGoogleError, googleAdsConnector, parseServiceAccountKey } from "./ads.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = JSON.stringify({ type: "service_account", client_email: "ads@proj.iam.gserviceaccount.com", private_key: privateKey, token_uri: "http://169.254.169.254/evil" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("google ads: errors & keys", () => {
  it("unwraps searchStream array errors and finds GoogleAdsFailure in later details", () => {
    const body = [{ error: { message: "The caller does not have permission", details: [{ "@type": "ErrorInfo", reason: "x" }, { errors: [{ message: "User doesn't have permission", errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }];
    expect(extractGoogleError(body, 403)).toMatch(/Quyền truy cập và bảo mật.*USER_PERMISSION_DENIED/);
  });
  it("rejects an OAuth client file pasted instead of a service-account key", () => {
    expect(() => parseServiceAccountKey(JSON.stringify({ web: { client_id: "x" } }))).toThrow(/OAuth client/);
    expect(parseServiceAccountKey(SA).client_email).toBe("ads@proj.iam.gserviceaccount.com");
  });
});

describe("google ads connector", () => {
  const routes = (handlers: Record<string, (body: any) => Response>) => vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    for (const [k, h] of Object.entries(handlers)) if (url.includes(k)) return h(body);
    throw new Error(`unexpected ${url}`);
  });

  it("signs a JWT at the fixed Google token endpoint (never the key's token_uri), flattens all chunks, micros → đồng, sets login-customer-id", async () => {
    const calls: { url: string; headers: any }[] = [];
    const f = routes({
      "oauth2.googleapis.com/token": () => json({ access_token: "ya29.x" }),
      ":listAccessibleCustomers": () => json({ resourceNames: ["customers/1110000000"] }),
      "/customers/1110000000/googleAds:searchStream": () => json([{ results: [
        { customerClient: { id: "1110000000", descriptiveName: "MCC", manager: true } },
        { customerClient: { id: "2220000000", descriptiveName: "TAKI Search", currencyCode: "VND", manager: false } },
      ] }]),
      "/customers/2220000000/googleAds:searchStream": () => json([
        { results: [{ campaign: { id: "9" }, segments: { date: "2026-10-05" }, metrics: { costMicros: "150000000000", impressions: "1000", clicks: "40", conversions: 2.5 } }] },
        { results: [{ campaign: { id: "9" }, segments: { date: "2026-10-06" }, metrics: { costMicros: "50000000000", impressions: "500", clicks: "10", conversions: 0 } }] },
      ]),
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, headers: init?.headers }); return f(url, init); }));
    const rows = await googleAdsConnector({ service_account_json: SA }).fetchAccountMetrics!("222-000-0000", "2026-10-05", "2026-10-06");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ adExternalId: "9", day: "2026-10-05", metrics: { spend: 150000, clicks: 40, results: 2.5 } });
    expect(calls.some((c) => c.url.includes("169.254.169.254"))).toBe(false);
    const metricCall = calls.find((c) => c.url.includes("/customers/2220000000/"));
    expect(metricCall?.headers["login-customer-id"]).toBe("1110000000");
  });

  it("refuses to change a SHARED budget (would move other campaigns too)", async () => {
    let mutated = false;
    vi.stubGlobal("fetch", routes({
      "oauth2.googleapis.com/token": () => json({ access_token: "ya29.x" }),
      ":listAccessibleCustomers": () => json({ resourceNames: ["customers/2220000000"] }),
      "campaignBudgets:mutate": () => { mutated = true; return json({}); },
      "googleAds:searchStream": (b) => json([{ results: String(b?.query).includes("customer_client")
        ? [{ customerClient: { id: "2220000000", descriptiveName: "A", manager: false } }]
        : [{ campaignBudget: { resourceName: "customers/2220000000/campaignBudgets/5", amountMicros: "1000000000", explicitlyShared: true, referenceCount: "3" } }] }]),
    }));
    await expect(googleAdsConnector({ service_account_json: SA }).updateBudget!({ externalId: "9", accountExternalId: "2220000000" } as any, 2_000_000, "k")).rejects.toThrow(/dùng chung cho 3 chiến dịch/);
    expect(mutated).toBe(false);
  });
});
