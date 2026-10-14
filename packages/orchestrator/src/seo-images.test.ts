import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q, update } from "@dotaka/db";

/** Bài SEO: 4 ảnh / 1000 chữ, đặt ở vị trí tối ưu SEO, chèn vào thân bài, tạo phần còn thiếu, xuất .zip. */
let aiOn = true;
let failGenerate = false;
vi.mock("@dotaka/llm-gateway", async (orig) => ({
  ...(await orig<typeof import("@dotaka/llm-gateway")>()),
  effectiveProvider: () => (aiOn ? { provider: "claude_cli", ready: true } : { provider: "sandbox", ready: true, reason: "sandbox" }),
  generate: async () => {
    if (failGenerate) throw new Error("Claude hết hạn mức");
    return { output: { headline: "Quy trình", alt: "Sơ đồ quy trình đưa AI vào doanh nghiệp", html: "<!doctype html><html><body>x</body></html>" }, model: "claude-test" };
  },
}));
const png = (): Buffer => { // PNG 64×64 hợp lệ, ~12 KB (đủ lớn để qua kiểm tra "tệp ảnh không rỗng")
  const w = 64; const raw = randomBytes((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) raw[y * (w * 3 + 1)] = 0; // bộ lọc dòng = 0
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body) >>> 0); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
vi.mock("./post-image.ts", async (orig) => ({
  ...(await orig<typeof import("./post-image.ts")>()),
  renderDesign: async (_html: string, out: string) => { writeFileSync(out, png()); },
  reviewDesign: async () => null,
  toJpeg: (p: string) => ({ path: p, mime: "image/png" }),
}));

const cwd = process.cwd();
const work = mkdtempSync(join(tmpdir(), "taki-seoimg-test-"));
let mod: typeof import("./seo-images.ts");
let exp: typeof import("./seo-export.ts");
let rt: typeof import("./runtime.ts");
beforeAll(async () => {
  process.env.DB_PATH = ":memory:"; openDb(":memory:");
  process.chdir(work);
  mod = await import("./seo-images.ts");
  exp = await import("./seo-export.ts");
  rt = await import("./runtime.ts");
});
afterAll(() => { process.chdir(cwd); rmSync(work, { recursive: true, force: true }); });

const w = (n: number, s: string) => Array.from({ length: n }, (_, i) => `từ${s}${i}`).join(" ");
/** Bài mẫu: dẫn nhập + 6 mục H2 (2 đoạn + danh sách) + kết luận ≈ 1.250 chữ. */
const article = (sections = 6) => [
  "Meta: Hướng dẫn đưa AI vào doanh nghiệp nhỏ trong 5 bước thực chiến cho chủ doanh nghiệp.", "Từ khóa: ứng dụng AI cho doanh nghiệp", "",
  `${w(60, "a")} ứng dụng AI cho doanh nghiệp`, "",
  ...Array.from({ length: sections }, (_, k) => [`## Mục ${k + 1} của bài`, "", w(90, `m${k}a`), "", w(90, `m${k}b`), "", "- ý một", "- ý hai", ""].join("\n")),
  "## Kết luận", "", w(60, "z"), "",
].join("\n");

let B = "";
const seo = (body = article(), over: Record<string, unknown> = {}) => insert("content_item", { biz_id: B, agent_key: "seo_web", kind: "seo_article", channel: "website", title: "Ứng dụng AI cho doanh nghiệp: 5 bước", body, status: "in_review", ...over });
beforeEach(() => {
  aiOn = true; failGenerate = false;
  for (const t of ["biz", "content_item", "creative_asset", "audit_log", "job", "task", "agent_config", "review_score", "approval"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
});

describe("số ảnh theo số chữ", () => {
  it("4 ảnh mỗi 1000 chữ, tối thiểu 4, tối đa 16", () => {
    expect(mod.requiredImages(1000)).toBe(4);
    expect(mod.requiredImages(1500)).toBe(6);
    expect(mod.requiredImages(2000)).toBe(8);
    expect(mod.requiredImages(300)).toBe(4);
    expect(mod.requiredImages(0)).toBe(4);
    expect(mod.requiredImages(20_000)).toBe(16);
  });
  it("đếm chữ của thân bài, không đếm Meta / Từ khoá / ảnh", () => {
    const { md } = mod.splitSeoBody(article());
    const blocks = mod.parseBlocks(md + "\n\n![alt dài dài dài](/v1/media/abc)\n");
    expect(mod.splitSeoBody(article()).header).toMatch(/^Meta:.*\nTừ khóa:.*\n\n$/);
    expect(blocks.filter((b) => b.kind === "image")).toHaveLength(1);
    const words = blocks.reduce((a, b) => a + b.words, 0);
    expect(words).toBeGreaterThan(1200); expect(words).toBeLessThan(1400);
  });
});

describe("vị trí đặt ảnh", () => {
  const plan = (body: string, count: number) => { const blocks = mod.parseBlocks(mod.splitSeoBody(body).md); return { blocks, slots: mod.planSlots(blocks, count, "Ứng dụng AI cho doanh nghiệp") }; };
  it("ảnh đầu bài ngay sau đoạn mở đầu; ảnh còn lại chia đều, sau đoạn văn, không liền nhau, không ở cuối bài", () => {
    const { blocks, slots } = plan(article(), 5);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toMatchObject({ role: "hero", after: 0, heading: "Ứng dụng AI cho doanh nghiệp" });
    expect(slots.slice(1).every((s) => s.role === "section")).toBe(true);
    for (const s of slots) expect(blocks[s.after].kind).toBe("para");
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].after - slots[i - 1].after).toBeGreaterThanOrEqual(2);
      expect(slots[i].offset - slots[i - 1].offset).toBeGreaterThanOrEqual(100); // chia đều theo số chữ
    }
    expect(slots[slots.length - 1].after).toBeLessThan(blocks.length - 1);
    expect(slots.slice(1).filter((s) => blocks[s.after - 1].kind === "heading").length).toBeGreaterThanOrEqual(2); // ưu tiên đoạn đầu của mục
    expect(slots[1].heading).toMatch(/^Mục \d/); // ảnh nói về mục mà nó nằm dưới
  });
  it("không bao giờ đặt ảnh giữa danh sách / bảng", () => {
    const body = ["## A", "", w(50, "a"), "", "- một", "- hai", "- ba", "", "| x | y |", "|---|---|", "| 1 | 2 |", "", "## B", "", w(50, "b"), "", w(50, "c"), "", "## C", "", w(50, "d"), "", w(50, "e"), ""].join("\n");
    const { blocks, slots } = plan(body, 4);
    for (const s of slots) expect(["para", "list", "table", "quote"]).toContain(blocks[s.after].kind);
    expect(new Set(slots.map((s) => s.after)).size).toBe(slots.length);
  });
  it("ảnh đã có chiếm chỗ: chỉ lấp khoảng trống lớn nhất, không đặt sát ảnh cũ", () => {
    const { md } = mod.splitSeoBody(article());
    const blocks = mod.parseBlocks(md);
    blocks.splice(1, 0, { kind: "image", text: "![x](/v1/media/old)", words: 0 }); // đã có ảnh đầu bài
    const slots = mod.planSlots(blocks, 4, "T");
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.role === "section")).toBe(true);
    expect(slots.every((s) => s.after !== 0 && s.after !== 1)).toBe(true);
  });
  it("bài quá ít đoạn: đặt được bao nhiêu thì đặt, không dồn ảnh", () => {
    const { slots } = plan(["## A", "", w(40, "a"), "", w(40, "b"), ""].join("\n"), 4);
    expect(slots.length).toBeLessThan(4);
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("alt text và tên tệp", () => {
  it("ảnh đầu bài luôn chứa từ khoá chính; alt ≤ 125 ký tự, không có ngoặc vuông", () => {
    expect(mod.seoAlt("Sơ đồ 5 bước", { role: "hero", heading: "T" }, "ứng dụng AI cho doanh nghiệp")).toBe("ứng dụng AI cho doanh nghiệp: Sơ đồ 5 bước");
    expect(mod.seoAlt("Ứng dụng AI cho doanh nghiệp nhỏ", { role: "hero", heading: "T" }, "ứng dụng ai cho doanh nghiệp")).toBe("Ứng dụng AI cho doanh nghiệp nhỏ");
    expect(mod.seoAlt("", { role: "section", heading: "Bước 2" }, "kw")).toBe("Minh họa Bước 2");
    const long = mod.seoAlt(`[${"rất dài ".repeat(40)}]`, { role: "section", heading: "H" }, "kw");
    expect(long.length).toBeLessThanOrEqual(125); expect(long).not.toMatch(/[\[\]]/);
  });
  it("tên tệp theo từ khoá, không dấu", () => {
    expect(mod.seoSlug("Ứng dụng AI cho doanh nghiệp")).toBe("ung-dung-ai-cho-doanh-nghiep");
    expect(mod.seoSlug("Đổi mới – Quản trị!")).toBe("doi-moi-quan-tri");
  });
});

describe("tạo ảnh cho bài SEO", () => {
  it("không có kết nối AI → bỏ qua, bài giữ nguyên (không chặn bài); gọi từ giao diện thì báo lỗi rõ", async () => {
    aiOn = false;
    const ci = seo();
    expect(await mod.ensureSeoImages(B, ci.id)).toMatchObject({ skipped: "no_ai", have: 0 });
    await expect(mod.ensureSeoImages(B, ci.id, { actor: "ceo" })).rejects.toMatchObject({ code: "IMAGE_AI_OFF" });
    expect(byId<any>("content_item", ci.id)!.body).toBe(article());
  });
  it("tạo đủ số ảnh, chèn vào thân bài đúng vị trí, ảnh đầu bài là ảnh đại diện", async () => {
    const ci = seo();
    const r = await mod.ensureSeoImages(B, ci.id);
    const need = mod.requiredImages(r.words);
    expect(r).toMatchObject({ made: need, failed: 0, have: need, required: need });
    const after = byId<any>("content_item", ci.id)!;
    const blocks = mod.parseBlocks(mod.splitSeoBody(after.body).md);
    const imgs = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.kind === "image");
    expect(imgs).toHaveLength(need);
    for (const { i } of imgs) { expect(blocks[i - 1].kind).toBe("para"); expect(blocks[i + 1]?.kind).not.toBe("image"); } // ảnh luôn sau 1 đoạn văn, không liền nhau
    expect(imgs[0].i).toBe(1); // ngay sau đoạn mở đầu
    const hero = /\(\/v1\/media\/([\w-]+)\)/.exec(imgs[0].b.text)![1];
    expect(after.asset_id).toBe(hero);
    expect(imgs[0].b.text).toMatch(/^!\[ứng dụng AI cho doanh nghiệp: /); // alt ảnh đầu bài có từ khoá
    expect(byId<any>("creative_asset", hero)!.meta).toMatchObject({ seo: true, role: "hero", contentItemId: ci.id });
    expect(byId<any>("creative_asset", hero)!.meta.filename).toMatch(/^ung-dung-ai-cho-doanh-nghiep-anh-dau-bai-1\.png$/);
    expect(after.body.startsWith("Meta: ")).toBe(true); // phần Meta / Từ khoá giữ nguyên
    expect(mod.seoImagesView(after)).toMatchObject({ have: need, missing: 0, required: need, busy: false });
  });
  it("chạy lại không tạo thêm; Sếp xoá 1 ảnh → chỉ tạo bù đúng 1 ảnh; tạo lại toàn bộ thay hết ảnh", async () => {
    const ci = seo();
    const first = await mod.ensureSeoImages(B, ci.id);
    expect(await mod.ensureSeoImages(B, ci.id)).toMatchObject({ made: 0, have: first.have });
    const body = byId<any>("content_item", ci.id)!.body as string;
    const lines = body.split("\n");
    const k = lines.findIndex((l, i) => i > 8 && l.startsWith("!["));
    update("content_item", ci.id, { body: lines.filter((_, i) => i !== k).join("\n") });
    expect(mod.seoImageStatus(byId<any>("content_item", ci.id)!).missing).toBe(1);
    expect(await mod.ensureSeoImages(B, ci.id)).toMatchObject({ made: 1, have: first.have });
    const before = new Set([...(byId<any>("content_item", ci.id)!.body as string).matchAll(/\/v1\/media\/([\w-]+)/g)].map((m) => m[1]));
    const all = await mod.ensureSeoImages(B, ci.id, { replaceAll: true });
    const now = new Set([...(byId<any>("content_item", ci.id)!.body as string).matchAll(/\/v1\/media\/([\w-]+)/g)].map((m) => m[1]));
    expect(all.made).toBe(first.have);
    expect(now.size).toBe(first.have);
    expect([...now].some((id) => before.has(id))).toBe(false);
  });
  it("lỗi tạo ảnh không làm hỏng bài: nội dung giữ nguyên, lý do được ghi lại", async () => {
    failGenerate = true;
    const ci = seo();
    const r = await mod.ensureSeoImages(B, ci.id);
    expect(r).toMatchObject({ made: 0, have: 0 });
    expect(r.errors[0]).toMatch(/hết hạn mức/);
    expect(byId<any>("content_item", ci.id)!.body).toBe(article());
    expect(q.all<any>("SELECT * FROM audit_log WHERE event = 'content.seo_images_created'")).toHaveLength(0);
  });
  it("bài đã lên lịch / đã đăng, hoặc không phải bài SEO: không tạo ảnh", async () => {
    await expect(mod.ensureSeoImages(B, seo(article(), { status: "scheduled" }).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const post = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "t", body: "b", status: "in_review" });
    expect(await mod.ensureSeoImages(B, post.id)).toMatchObject({ skipped: "kind" });
    expect(() => mod.queueSeoImages(B, post.id)).toThrow(/bài SEO/);
  });
  it("xếp việc chạy nền: 1 việc / bài, trả trạng thái bận", () => {
    const ci = seo();
    expect(mod.queueSeoImages(B, ci.id, { actor: "ceo" })).toEqual({ queued: true });
    expect(mod.seoImagesView(byId<any>("content_item", ci.id)!)!.busy).toBe(true);
    expect(() => mod.queueSeoImages(B, ci.id)).toThrow(/đang được tạo ảnh/);
    aiOn = false;
    expect(() => mod.queueSeoImages(B, seo().id)).toThrow(/kết nối AI|sandbox/);
  });
  it("ảnh đại diện luôn khớp bản Sếp sửa", async () => {
    const ci = seo();
    await mod.ensureSeoImages(B, ci.id);
    const lines = (byId<any>("content_item", ci.id)!.body as string).split("\n");
    const hero = lines.findIndex((l) => l.startsWith("!["));
    update("content_item", ci.id, { body: lines.filter((_, i) => i !== hero).join("\n") }); // Sếp bỏ ảnh đầu bài
    mod.syncSeoFeatured(ci.id);
    const next = /\(\/v1\/media\/([\w-]+)\)/.exec(byId<any>("content_item", ci.id)!.body)![1];
    expect(byId<any>("content_item", ci.id)!.asset_id).toBe(next);
  });
});

describe("xuất bài + ảnh", () => {
  it("zip hợp lệ: html chuẩn SEO + markdown + images/ đặt tên theo từ khoá, ảnh có alt / width / height / lazy", async () => {
    const ci = seo();
    const r = await mod.ensureSeoImages(B, ci.id);
    const x = await exp.buildSeoExport(ci.id);
    expect(x.filename).toBe("ung-dung-ai-cho-doanh-nghiep.zip");
    expect(x.images).toBe(r.have);
    // đọc lại thư mục trung tâm của zip và kiểm CRC từng tệp
    const z = x.zip; const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = z.readUInt16LE(eocd + 10); let p = z.readUInt32LE(eocd + 16);
    const files = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
      const crc = z.readUInt32LE(p + 16), size = z.readUInt32LE(p + 20), nameLen = z.readUInt16LE(p + 28), off = z.readUInt32LE(p + 42);
      const name = z.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      const data = z.subarray(off + 30 + z.readUInt16LE(off + 26) + z.readUInt16LE(off + 28), off + 30 + z.readUInt16LE(off + 26) + z.readUInt16LE(off + 28) + size);
      expect(crc32(data) >>> 0).toBe(crc);
      files.set(name, data); p += 46 + nameLen;
    }
    expect([...files.keys()].filter((n) => n.startsWith("images/"))).toHaveLength(r.have);
    const html = files.get("ung-dung-ai-cho-doanh-nghiep.html")!.toString("utf8");
    expect(html).toContain("<title>Ứng dụng AI cho doanh nghiệp: 5 bước</title>");
    expect(html).toContain('<meta name="description" content="Hướng dẫn đưa AI');
    expect(html).toMatch(/<h1>Ứng dụng AI cho doanh nghiệp: 5 bước<\/h1>/);
    expect((html.match(/<figure>/g) ?? []).length).toBe(r.have);
    expect(html).not.toMatch(/<p><figure>/); // không lồng figure trong p
    expect(html).not.toContain("/v1/media/"); expect(html).not.toContain("data:image");
    expect(html).toMatch(/<img src="images\/ung-dung-ai-cho-doanh-nghiep-anh-dau-bai-1\.png" alt="ứng dụng AI cho doanh nghiệp: [^"]+" width="64" height="64" decoding="async" fetchPriority="high"/);
    expect((html.match(/loading="lazy"/g) ?? []).length).toBe(r.have - 1); // chỉ ảnh đầu bài tải ưu tiên
    const md = files.get("ung-dung-ai-cho-doanh-nghiep.md")!.toString("utf8");
    expect(md).toContain("](images/"); expect(md).not.toContain("/v1/media/");
  }, 60_000); // lần đầu nạp react-markdown + react-dom/server mất vài giây khi cả bộ test chạy song song
});

describe("bước cuối của vòng agent: ảnh rồi mới vào hộp Duyệt, chạy ở hàng đợi riêng", () => {
  const setup = () => {
    insert("agent_config", { biz_id: B, agent_key: "seo_web", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1, token_budget_day: 1, limits: {} });
    const task = insert("task", { biz_id: B, goal_id: null, agent_key: "seo_web", title: "Bài SEO", status: "in_review", input: {}, depends_on: [] });
    const rev = insert("review_score", { biz_id: B, subject_type: "content_item", subject_id: "x", rubric_key: "seo_article", rubric_version: 2, total: 90, verdict: "pass", result: {} });
    const ci = seo(article(), { task_id: task.id, review_score_id: rev.id });
    return { task, ci };
  };
  it("tạo đủ ảnh trong thân bài rồi tạo mục duyệt (bản duyệt đã có ảnh)", async () => {
    const { task, ci } = setup();
    await rt.finalizeTask(task.id, "run1");
    const a = q.get<any>("SELECT * FROM approval WHERE subject_id = ?", task.id);
    expect(byId<any>("task", task.id)!.status).toBe("awaiting_approval");
    expect(a.status).toBe("pending");
    expect(a.preview.imageError).toBeUndefined();
    expect(a.preview.body).toMatch(/!\[.+\]\(\/v1\/media\//); // mục duyệt thấy bài đã có ảnh
    expect(mod.seoImageStatus(byId<any>("content_item", ci.id)!).missing).toBe(0);
    await rt.finalizeTask(task.id, "run1"); // chạy lại không tạo thêm mục duyệt / ảnh
    expect(q.all<any>("SELECT id FROM approval WHERE subject_id = ?", task.id)).toHaveLength(1);
  });
  it("thiếu ảnh thì KHÔNG tự duyệt: mục duyệt ghi rõ thiếu bao nhiêu ảnh", async () => {
    failGenerate = true;
    const { task } = setup();
    update("agent_config", q.get<any>("SELECT id FROM agent_config").id, { autonomy: "L3" }); // mức tự chủ cao vẫn phải chờ Sếp
    await rt.finalizeTask(task.id, "run1");
    const a = q.get<any>("SELECT * FROM approval WHERE subject_id = ?", task.id);
    expect(byId<any>("task", task.id)!.status).toBe("awaiting_approval");
    expect(a.preview.imageError).toMatch(/Mới có 0\/\d+ ảnh/);
  });
  it("máy chủ khởi động lại giữa chừng: agent.run của bài đang in_review xếp bước cuối vào hàng đợi image (không viết lại bài, không chiếm chỗ agent)", async () => {
    const { task, ci } = setup();
    const before = byId<any>("content_item", ci.id)!.body;
    await rt.runTask(task.id);
    const jobs = q.all<any>("SELECT queue, name, lock_key FROM job WHERE name = 'task.finalize'");
    expect(jobs).toEqual([{ queue: "image", name: "task.finalize", lock_key: `finalize:${task.id}` }]);
    expect(byId<any>("task", task.id)!.status).toBe("in_review"); // chưa làm gì nặng trong hàng đợi agent
    expect(byId<any>("content_item", ci.id)!.body).toBe(before);
    await rt.finalizeTask(task.id); // worker của hàng đợi image chạy job này
    expect(byId<any>("task", task.id)!.status).toBe("awaiting_approval");
    expect(byId<any>("content_item", ci.id)!.body).toContain("/v1/media/");
  });
  it("chỉ bước cuối chạy ở hàng đợi image; lệnh vòng agent không chiếm chỗ hàng đợi agent", async () => {
    const { task } = setup();
    expect(q.all<any>("SELECT queue FROM job WHERE name = 'task.finalize'")).toHaveLength(0);
    await rt.finalizeTask(task.id);
    expect(byId<any>("task", task.id)!.status).toBe("awaiting_approval");
  });
});
