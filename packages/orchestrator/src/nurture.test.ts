import { describe, expect, it } from "vitest";
import { ConnectorError } from "@dotaka/connectors";
import { AppError } from "@dotaka/shared";
import { fillTemplate, friendCheckInterval, sendOutcome, truncateGreeting } from "./nurture.ts";

describe("nurture templates", () => {
  it("fills variables", () => {
    expect(fillTemplate("Chào {ten}, {san_pham} tại: {link}", { ten: "Lan", san_pham: "AI Business System", link: "https://x.vn" }))
      .toBe("Chào Lan, AI Business System tại: https://x.vn");
  });
  it("drops the sentence holding {link} when there is no link", () => {
    expect(fillTemplate("Chào {ten}. Chi tiết tại: {link}\n{ten} để lại SĐT nhé!", { ten: "Lan", san_pham: "x", link: null }))
      .toBe("Chào Lan. Lan để lại SĐT nhé!");
  });
  it("cuts Zalo greetings at 150 chars", () => {
    expect(truncateGreeting("a".repeat(200))).toHaveLength(150);
  });
});

describe("send outcome (no duplicate messages to real customers)", () => {
  it("treats refused requests as not sent", () => {
    expect(sendOutcome(new ConnectorError("InvalidRequest", "x"))).toBe("not_sent");
    expect(sendOutcome(new AppError("X", "x"))).toBe("not_sent");
    expect(sendOutcome(Object.assign(new ConnectorError("Transient", "x"), { requestNotSent: true }))).toBe("not_sent");
  });
  it("treats timeouts / unknown errors as unknown (needs_check, never auto-resent)", () => {
    expect(sendOutcome(new ConnectorError("Transient", "timeout"))).toBe("unknown");
    expect(sendOutcome(new Error("boom"))).toBe("unknown");
  });
  it("slows friend-accept checks over time", () => {
    expect(friendCheckInterval(60_000)).toBe(20 * 60_000);
    expect(friendCheckInterval(5 * 3600_000)).toBe(3600_000);
    expect(friendCheckInterval(30 * 3600_000)).toBe(6 * 3600_000);
  });
});
