import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { audit, insert, q, update, type Row } from "@dotaka/db";
import { sha256 } from "@dotaka/shared";

/**
 * Skill library: imports the Marketing department's Claude Code skills (~/.claude/skills/<name>/SKILL.md
 * + references/) and staff definitions (~/.claude/agents/mkt-*.md) into the DB, versioned by content hash,
 * and binds them to system agents. At run time `agentPlaybook()` assembles, within a size budget:
 *   1. DNA layer   — taki-dna (+ references) and the department brand sheet: the single source of truth
 *   2. Persona     — the mkt-* staff member this agent plays
 *   3. Playbooks   — that staff member's skills (methods, formulas, scoring rubrics)
 * Skills were written for interactive Claude Code sessions, so a wrapper tells the model to apply their
 * methods but ignore steps like asking questions, writing files or calling tools.
 */
/**
 * Skills ship with the repo (assets/claude, refreshed from ~/.claude by `pnpm skills:export`) so every
 * machine runs the exact same playbooks. Set SKILLS_DIR / CLAUDE_AGENTS_DIR to read another folder.
 */
export const BUNDLE_DIR = fileURLToPath(new URL("../../../assets/claude/", import.meta.url));
export const USER_CLAUDE_DIR = join(homedir(), ".claude");
export const SKILLS_DIR = process.env.SKILLS_DIR ?? join(BUNDLE_DIR, "skills");
export const AGENTS_DIR = process.env.CLAUDE_AGENTS_DIR ?? join(BUNDLE_DIR, "agents");

export const DNA_SKILL = "taki-dna";
export const DEPT_SKILL = "phong-marketing";

/** Department staff -> system agents. Skill lists are read from each staff file, so edits in ~/.claude flow in. */
export const TEAM: { employee: string | null; label: string; agents: string[]; extraSkills?: string[] }[] = [
  { employee: "mkt-nghien-cuu", label: "Nghiên cứu & Insight", agents: ["market_research"] },
  { employee: "mkt-chien-luoc", label: "Chiến lược & Kế hoạch", agents: ["brief", "strategy"], extraSkills: ["mkt-workflow"] },
  { employee: "mkt-content", label: "Content Writer", agents: ["content"] },
  { employee: "mkt-video", label: "Biên kịch Video", agents: ["video_script"] },
  { employee: "mkt-seo", label: "SEO", agents: ["seo_web"] },
  { employee: "mkt-ads", label: "Quảng cáo", agents: ["ads"] },
  { employee: "mkt-phan-tich", label: "Phân tích dữ liệu", agents: ["analytics"] },
  { employee: "mkt-kiem-duyet", label: "Kiểm duyệt", agents: ["review"], extraSkills: ["remove-ai-marks"] },
  { employee: null, label: "Tư vấn bán hàng (ABS)", agents: ["chat"], extraSkills: ["abs-sales-agent", "objection-handler-ai-sales", "lead-qualifier-taki"] },
  { employee: null, label: "Chăm sóc lead", agents: ["follow_up"], extraSkills: ["follow-up-sequence-abs"] },
  { employee: null, label: "Sản xuất video Flow", agents: ["creative"], extraSkills: ["flow-review-do-an-vat", "flow-review-thoi-trang", "flow-nguoi-que-so-sanh", "flow-video-nhan-hieu", "video-nhan-hieu-google-flow", "flow-koc-thoi-trang-nu", "flow-review-gia-dung", "flow-review-nha-hang-shop", "news-to-video", "flow-cooking-director-video", "flow-cinematic-short-film"] },
];
/** Agents that read the DNA layer when they call Claude. */
export const LLM_AGENTS = ["brief", "market_research", "strategy", "content", "video_script", "seo_web", "chat", "follow_up", "review", "ads", "analytics"];

/** Characters of skill text an agent may receive (≈ 3–4 chars per token). */
export const BUDGET: Record<string, number> = {
  chat: 45_000, follow_up: 36_000, review: 70_000, default: 95_000,
};
/** DNA reference files per agent (default: all). Sales-facing agents get the product/voice/customer sheets. */
const DNA_REFS: Record<string, string[]> = {
  chat: ["references/san-pham.md", "references/giong-thuong-hieu.md", "references/khach-hang.md"],
  follow_up: ["references/san-pham.md", "references/giong-thuong-hieu.md"],
};

// ---------------- Reading from disk ----------------
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  let key = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; meta[key] = kv[2].replace(/^["'>|-]+\s*|["']$/g, "").trim(); }
    else if (key && line.trim()) meta[key] = `${meta[key]} ${line.trim()}`.trim();
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

function readSkillDir(name: string) {
  const dir = join(SKILLS_DIR, name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
  const refs: { path: string; size: number; content: string }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p !== file && /\.(md|txt|json|csv|ya?ml)$/i.test(f)) {
        const content = readFileSync(p, "utf8");
        refs.push({ path: relative(dir, p), size: content.length, content });
      }
    }
  };
  walk(dir);
  return { name: meta.name ?? name, description: meta.description ?? "", body, refs, path: file };
}

/** Skill names a staff file lists under "Skill được dùng" (lines like "- `skill-name` — ..."). */
export function staffSkills(employee: string): string[] {
  const file = join(AGENTS_DIR, `${employee}.md`);
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/^- `([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

// ---------------- Sync into the DB ----------------
function upsert(bizId: string, key: string, kind: string, grp: string | null, data: { name: string; description: string; body: string; refs: unknown[]; path: string }) {
  const hash = sha256(data.body + JSON.stringify(data.refs));
  const size = data.body.length + (data.refs as { size: number }[]).reduce((a, r) => a + (r.size ?? 0), 0);
  const cur = q.get<Row>("SELECT * FROM skill WHERE biz_id = ? AND key = ?", bizId, key);
  const now = new Date().toISOString();
  if (!cur) {
    insert("skill", { biz_id: bizId, key, kind, name: data.name, description: data.description, body: data.body, refs: data.refs, source_path: data.path, hash, version: 1, size, grp, status: "active", synced_at: now });
    return "added";
  }
  if (cur.hash === hash) { update("skill", cur.id, { synced_at: now, grp: grp ?? cur.grp }); return "unchanged"; }
  update("skill", cur.id, { name: data.name, description: data.description, body: data.body, refs: data.refs, hash, version: cur.version + 1, size, synced_at: now, grp: grp ?? cur.grp, status: "active" });
  return "updated";
}

function bind(bizId: string, agentKey: string, skillKey: string, role: string, priority: number) {
  if (q.get("SELECT id FROM agent_skill WHERE biz_id = ? AND agent_key = ? AND skill_key = ?", bizId, agentKey, skillKey)) return;
  insert("agent_skill", { biz_id: bizId, agent_key: agentKey, skill_key: skillKey, role, priority, enabled: 1 });
}

export interface SyncReport { added: string[]; updated: string[]; unchanged: string[]; missing: string[]; bindings: number; skillsDir: string; agentsDir: string }

export function syncSkills(bizId: string, actor = "system"): SyncReport {
  const report: SyncReport = { added: [], updated: [], unchanged: [], missing: [], bindings: 0, skillsDir: SKILLS_DIR, agentsDir: AGENTS_DIR };
  const note = (key: string, r: string) => (r === "added" ? report.added : r === "updated" ? report.updated : report.unchanged).push(key);

  for (const key of [DNA_SKILL, DEPT_SKILL]) {
    const s = readSkillDir(key);
    if (!s) { report.missing.push(key); continue; }
    note(key, upsert(bizId, key, "dna", "DNA & luật phòng", s));
    for (const a of LLM_AGENTS) bind(bizId, a, key, "dna", key === DNA_SKILL ? 0 : 1);
  }
  for (const member of TEAM) {
    if (member.employee) {
      const file = join(AGENTS_DIR, `${member.employee}.md`);
      if (existsSync(file)) {
        const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
        note(member.employee, upsert(bizId, member.employee, "persona", member.label, { name: meta.name ?? member.employee, description: meta.description ?? "", body, refs: [], path: file }));
        for (const a of member.agents) bind(bizId, a, member.employee, "persona", 5);
      } else report.missing.push(member.employee);
    }
    const skills = [...(member.employee ? staffSkills(member.employee) : []), ...(member.extraSkills ?? [])];
    skills.forEach((key, i) => {
      const s = readSkillDir(key);
      if (!s) { report.missing.push(key); return; }
      note(key, upsert(bizId, key, "skill", member.label, s));
      for (const a of member.agents) bind(bizId, a, key, "playbook", 10 + i);
    });
  }
  report.bindings = q.scalar<number>("SELECT COUNT(*) FROM agent_skill WHERE biz_id = ?", bizId);
  audit(bizId, actor, "skills.synced", undefined, { added: report.added.length, updated: report.updated.length, missing: report.missing });
  return report;
}

// ---------------- Prompt assembly ----------------
const WRAPPER = [
  "Các khối dưới đây là DNA, vai trò và SKILL của phòng Marketing AI của doanh nghiệp (xuất từ Claude Code).",
  "Áp dụng đúng phương pháp, công thức, tiêu chí chấm và luật giọng/claim trong đó.",
  "BỎ QUA các bước dành cho phiên làm việc tương tác: hỏi lại người dùng, đọc/ghi file, tạo thư mục, gọi Skill/Agent/tool, xuất file HTML/DOCX/Excel, báo cáo trong chat.",
  "Mọi đường dẫn file được nhắc tới đã được nạp sẵn nội dung ở đây. Đầu ra LUÔN là JSON đúng schema của hệ thống.",
  "Ví dụ, tên thương hiệu, sản phẩm, số liệu trong skill chỉ là MẪU: luôn thay bằng thông tin trong DNA của doanh nghiệp đang dùng. Nếu skill mâu thuẫn DNA thì theo DNA.",
].join("\n");

export interface PlaybookPart { key: string; role: string; version: number; chars: number; truncated: boolean }

export function agentPlaybook(bizId: string, agentKey: string): { text: string; parts: PlaybookPart[] } {
  const rows = q.all<Row>(
    `SELECT b.role, b.priority, s.key, s.name, s.body, s.refs, s.version FROM agent_skill b JOIN skill s ON s.biz_id = b.biz_id AND s.key = b.skill_key
     WHERE b.biz_id = ? AND b.agent_key = ? AND b.enabled = 1 AND s.status = 'active' ORDER BY b.priority, s.key`, bizId, agentKey);
  if (!rows.length) return { text: "", parts: [] };
  let budget = BUDGET[agentKey] ?? BUDGET.default;
  const parts: PlaybookPart[] = [];
  const blocks: string[] = [WRAPPER];
  for (const r of rows) {
    const title = r.role === "dna" ? `DNA · ${r.name}` : r.role === "persona" ? `VAI TRÒ · ${r.name}` : `SKILL · ${r.name}`;
    let text = r.body as string;
    // DNA references are always wanted; other skills' references only while budget is generous.
    const refs = (r.refs as { path: string; content: string }[]) ?? [];
    for (const ref of refs) {
      const wanted = r.role === "dna" ? !DNA_REFS[agentKey] || DNA_REFS[agentKey].includes(ref.path) : text.length + ref.content.length < budget * 0.3;
      if (wanted) text += `\n\n### [${ref.path}]\n${ref.content}`;
    }
    const truncated = text.length > budget;
    if (budget <= 400) { parts.push({ key: r.key, role: r.role, version: r.version, chars: 0, truncated: true }); continue; }
    const piece = truncated ? `${text.slice(0, budget - 200)}\n…(đã rút gọn vì giới hạn ngữ cảnh)` : text;
    blocks.push(`<${r.role} key="${r.key}" v="${r.version}">\n# ${title}\n${piece}\n</${r.role}>`);
    budget -= piece.length;
    parts.push({ key: r.key, role: r.role, version: r.version, chars: piece.length, truncated });
  }
  return { text: blocks.join("\n\n"), parts };
}

export function listSkills(bizId: string) {
  const skills = q.all<Row>("SELECT id, key, kind, name, description, grp, version, size, hash, source_path, synced_at, status, json_array_length(refs) refs_count FROM skill WHERE biz_id = ? ORDER BY kind, grp, key", bizId);
  const bindings = q.all<Row>("SELECT agent_key, skill_key, role, priority, enabled FROM agent_skill WHERE biz_id = ? ORDER BY agent_key, priority", bizId);
  return { skills, bindings, team: TEAM.map((t) => ({ ...t, skills: [...(t.employee ? staffSkills(t.employee) : []), ...(t.extraSkills ?? [])] })), skillsDir: SKILLS_DIR, agentsDir: AGENTS_DIR, budget: BUDGET };
}
