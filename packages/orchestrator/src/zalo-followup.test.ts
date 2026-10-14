import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";

// Ghi lại yêu cầu gửi tới generate() (vẫn chạy nhánh sandbox thật) để kiểm tra PII không lọt ra model ngoài.
const calls: Row[] = [];
vi.mock("@dotaka/llm-gateway", async (orig) => {
  const m = await orig<typeof import("@dotaka/llm-gateway")>();
  return { ...m, generate: (req: Row) => { calls.push(req); return m.generate(req as never); } };
});

const { addressNameOf, fillName, maskCustomerText, simulateZalo } = await import("./zalo-followup.ts");

describe("che tên/SĐT khách trong follow-up Zalo", () => {
  it("tên gọi = chữ cuối họ tên; tên chung chung → null", () => {
    expect(addressNameOf("Nguyễn Thị Hoa")).toBe("Hoa");
    expect(addressNameOf("Khách Zalo")).toBeNull();
    expect(addressNameOf("")).toBeNull();
  });
  it("maskCustomerText che SĐT + tên (nguyên từ), fillName điền lại tại máy", () => {
    const t = maskCustomerText("Chào chị Hoa, Nguyễn Thị Hoa gọi 0912 345 678 nhé. Hoàng hôn đẹp", "Nguyễn Thị Hoa");
    expect(t).not.toMatch(/Hoa\b|Nguyễn/);
    expect(t).not.toContain("345 678");
    expect(t).toContain("Hoàng hôn"); // không che nhầm từ chỉ chứa tên
    expect(fillName("Dạ chị {ten} ơi", "Hoa")).toBe("Dạ chị Hoa ơi");
    expect(fillName("Dạ anh/chị {ten} ạ.", null)).toBe("Dạ anh/chị ạ.");
  });
});

describe("prompt follow-up gửi generate()", () => {
  let B: string;
  beforeAll(() => {
    process.env.DB_PATH = ":memory:";
    openDb(":memory:");
    B = insert("biz", { name: "TAKI Test", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    insert("connection", { biz_id: B, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: "", status: "active", mode: "sandbox", config: { accounts: [{ id: "nick1", name: "Nick Shop" }] } });
  });
  afterAll(() => closeDb());

  it("không chứa tên thật hay SĐT của khách; tin nháp điền đúng tên tại máy", async () => {
    calls.length = 0;
    const r = await simulateZalo(B, { customerName: "Nguyễn Thị Hoa", customerText: "Em là Hoa, số em 0912345678, tư vấn giúp em khoá học", staffText: "Dạ chào chị Hoa, em gửi chị thông tin khoá học ạ" }, "test");
    expect(r.drafted).toBe(1);
    const req = calls.find((c) => String(c.system ?? "").includes("FOLLOW-UP"));
    expect(req).toBeTruthy();
    const sent = `${req!.system}\n${req!.user}`;
    expect(sent).not.toContain("Nguyễn Thị Hoa");
    expect(sent).not.toMatch(/(?<!\p{L})Hoa(?!\p{L})/u);
    expect(sent).not.toContain("0912345678");
    expect(sent).not.toContain("912345678");
    expect(sent).toContain("{ten}");
    const appr = q.get<Row>("SELECT preview FROM approval WHERE biz_id = ? AND subject_type = 'follow_up'", B)!;
    const text = (typeof appr.preview === "string" ? JSON.parse(appr.preview) : appr.preview).text as string;
    expect(text).toContain("Hoa");
    expect(text).not.toContain("{ten}");
  });
});
