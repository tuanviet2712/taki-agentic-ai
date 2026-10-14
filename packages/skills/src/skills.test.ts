import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { BUDGET, SKILLS_DIR, TEAM, agentPlaybook, listSkills, parseFrontmatter, syncSkills } from "./index.ts";

/** "Skill phụ": các skill affiliate gắn thêm vào agent (kịch bản video, Veo3 theo kênh, dựng video, bán hàng, chấm điểm). */
const EXTRA_BY_AGENT: Record<string, string[]> = {
  content: ["taki-landing-builder", "prompt-card-carousel"],
  video_script: ["ecom-ai-video-creator", "autovis-script", "news-to-video", "fape-video-script", "hon-nhan-dao-ly-script", "video-viral-dao-ly-trung-quoc",
    "content-creator-dao-ly", "facebook-viral-script-factory", "nguoi-que-ai-prompt", "kich-ban-card-ai"],
  review: ["remove-ai-marks", "cham-diem-noi-dung"],
  chat: ["abs-sales-agent", "objection-handler-ai-sales", "lead-qualifier-taki", "telesales-ai-chu-doanh-nghiep", "lead-hunter-qualifier"],
  creative: ["flow-anh-chan-dung-cu-dong", "bac-si-baby-veo3", "ong-ban-sua-veo3", "nguoi-noi-dao-ly-veo3", "me-bim-cho-que", "tho-trang-nau-an-veo3",
    "tieng-anh-tre-em-veo3", "veo3-tra-an-nhien", "yen-mach-veo3-animation", "tro-ly-edit-video", "video-edit-ai-keynote", "viral-video-editor", "remotion-best-practices"],
};
const NEW_SKILLS = [...new Set(Object.values(EXTRA_BY_AGENT).flat())];

const extrasOf = (agent: string) => TEAM.filter((t) => t.agents.includes(agent)).flatMap((t) => t.extraSkills ?? []);

describe("parseFrontmatter", () => {
  const lf = "---\nname: demo\ndescription: >\n  Mô tả dài\n  nhiều dòng\n---\nNội dung\nhai dòng\n";
  it("CRLF (Windows autocrlf) và BOM cho kết quả giống LF", () => {
    const a = parseFrontmatter(lf);
    expect(a.meta.name).toBe("demo");
    expect(a.meta.description).toBe("Mô tả dài nhiều dòng");
    expect(a.body).toBe("Nội dung\nhai dòng");
    expect(parseFrontmatter(lf.replace(/\n/g, "\r\n"))).toEqual(a);
    expect(parseFrontmatter("﻿" + lf.replace(/\n/g, "\r\n"))).toEqual(a);
  });
  it("không có frontmatter -> cả file là body; frontmatter đóng ở cuối file vẫn đọc được", () => {
    expect(parseFrontmatter("chỉ có nội dung")).toEqual({ meta: {}, body: "chỉ có nội dung" });
    expect(parseFrontmatter("---\nname: x\n---")).toEqual({ meta: { name: "x" }, body: "" });
  });
});

describe("kho skill bundle (assets/claude/skills)", () => {
  const dirs = readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory());

  it("mọi skill phụ có trong TEAM đều có thư mục + SKILL.md trên đĩa", () => {
    for (const [agent, skills] of Object.entries(EXTRA_BY_AGENT)) {
      for (const s of skills) {
        expect(extrasOf(agent), `${agent} thiếu ${s}`).toContain(s);
        expect(existsSync(join(SKILLS_DIR, s, "SKILL.md")), `không có thư mục skill ${s}`).toBe(true);
      }
    }
    for (const t of TEAM) for (const s of t.extraSkills ?? []) expect(existsSync(join(SKILLS_DIR, s, "SKILL.md")), s).toBe(true);
  });

  it("không khai báo trùng skill trong cùng một nhóm", () => {
    for (const t of TEAM) expect(new Set(t.extraSkills ?? []).size, t.label).toBe((t.extraSkills ?? []).length);
  });

  it("mọi skill phụ: frontmatter có name = tên thư mục + description; thân không rỗng; mỗi skill không quá 400k ký tự văn bản", () => {
    for (const s of NEW_SKILLS) {
      const raw = readFileSync(join(SKILLS_DIR, s, "SKILL.md"), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      expect(meta.name, s).toBe(s);
      expect(meta.description?.length ?? 0, `${s} thiếu description`).toBeGreaterThan(20);
      expect(body.length, s).toBeGreaterThan(200);
      expect(body.startsWith("---"), `${s}: frontmatter lọt vào thân`).toBe(false);
      let total = 0;
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(md|txt|json|csv|ya?ml)$/i.test(f)) total += statSync(p).size;
        }
      };
      walk(join(SKILLS_DIR, s));
      expect(total, s).toBeLessThan(400_000);
    }
  });

  it("không có khoá / token / private key dán sẵn trong bất kỳ skill nào", () => {
    const re = /(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|EAA[A-Za-z0-9]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{30,})/;
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(md|txt|json|csv|ya?ml|py|sh|html|tsx?)$/i.test(f) && re.test(readFileSync(p, "utf8"))) bad.push(p);
      }
    };
    for (const d of dirs) walk(join(SKILLS_DIR, d));
    expect(bad).toEqual([]);
  });
});

describe("syncSkills + agentPlaybook với skill phụ", () => {
  let B = "";
  beforeAll(() => {
    openDb(":memory:");
    B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  });
  afterAll(() => closeDb());

  it("nạp đủ skill phụ vào DB (active), gắn đúng agent, không thiếu skill nào", () => {
    const r = syncSkills(B, "test");
    expect(r.missing).toEqual([]);
    for (const s of NEW_SKILLS) {
      const row = q.get<Row>("SELECT status, kind, description, size FROM skill WHERE biz_id = ? AND key = ?", B, s);
      expect(row?.status, s).toBe("active");
      expect(row?.kind, s).toBe("skill");
      expect(String(row?.description ?? "").length, `${s} description`).toBeGreaterThan(20);
      expect(Number(row?.size), s).toBeGreaterThan(200);
    }
    for (const [agent, skills] of Object.entries(EXTRA_BY_AGENT)) {
      for (const s of skills) {
        const b = q.get<Row>("SELECT role, enabled FROM agent_skill WHERE biz_id = ? AND agent_key = ? AND skill_key = ?", B, agent, s);
        expect(b, `${agent} <- ${s}`).toBeTruthy();
        expect(b?.enabled).toBe(1);
      }
    }
  });

  it("đồng bộ lần 2 không đổi gì (hash ổn định), kết quả hiện trong listSkills (trang Skill & Nhân viên MKT)", () => {
    const again = syncSkills(B, "test");
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    const l = listSkills(B);
    const keys = new Set(l.skills.map((s) => s.key as string));
    for (const s of NEW_SKILLS) expect(keys.has(s), s).toBe(true);
    for (const t of l.team) for (const s of t.extraSkills ?? []) expect(t.skills).toContain(s);
  });

  it("nạp ngân sách prompt: tổng ký tự mỗi agent không vượt BUDGET, DNA luôn đứng đầu", () => {
    for (const agent of ["content", "video_script", "review", "chat"]) {
      const p = agentPlaybook(B, agent);
      const used = p.parts.reduce((a, x) => a + x.chars, 0);
      expect(used, agent).toBeLessThanOrEqual(BUDGET[agent] ?? BUDGET.default);
      expect(p.parts[0]?.role, agent).toBe("dna");
      expect(p.text.length, agent).toBeGreaterThan(0);
    }
  });
  it("chat và follow-up đọc tham chiếu DNA kể cả đường dẫn Windows trong DB cũ", () => {
    const dna = q.get<Row>("SELECT * FROM skill WHERE biz_id = ? AND key = 'taki-dna'", B)!;
    const refs = (dna.refs as { path: string; content: string; size: number }[]).map((r) => ({ ...r, path: r.path.replace(/\//g, "\\") }));
    update("skill", dna.id, { refs });
    try {
      for (const agent of ["chat", "follow_up"]) {
        const p = agentPlaybook(B, agent);
        expect(p.text, agent).toContain("references\\san-pham.md");
        expect(p.text, agent).toContain("references\\giong-thuong-hieu.md");
      }
    } finally { update("skill", dna.id, { refs: dna.refs }); }
  });
});
