import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { audit, insert, q, update, type Row } from "@dotaka/db";
import { ensureAutomations, saveAutomation } from "@dotaka/orchestrator";

/**
 * Workspace snapshot (config/taki-workspace.json): the business configuration the CEO set up in the UI —
 * DNA, settings, agent autonomy/models, ad templates, automation flows, knowledge added by hand.
 * Committed with the repo so a fresh install on another machine starts with the SAME configuration.
 * Never contains secrets or runtime data (tokens, connections, conversations, ads, DB rows of activity).
 */
export const WORKSPACE_FILE = resolve(process.env.WORKSPACE_FILE ?? "config/taki-workspace.json");
const SEED_SOURCES = /^skill taki-dna/;
// Rule/automation fields that point at this machine's connected accounts — dropped on export.
const LOCAL_REFS = ["accountIds", "sheetConnectionId", "adIds", "channelIds", "adAccountId", "templateId"];

export function exportWorkspace(bizId: string) {
  const biz = q.get<Row>("SELECT name, timezone, currency, settings FROM biz WHERE id = ?", bizId)!;
  const { killSwitch: _k, ...settings } = biz.settings ?? {};
  // Account choice belongs to this install/business, never to a portable workspace template.
  if (settings.llm) settings.llm = { ...settings.llm, codexAccountId: null };
  const snap = {
    version: 1,
    exportedAt: new Date().toISOString(),
    biz: { name: biz.name, timezone: biz.timezone, currency: biz.currency },
    dna: q.get<Row>("SELECT data FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", bizId)?.data ?? null,
    settings,
    agents: q.all<Row>("SELECT agent_key, autonomy, enabled, token_budget_day, limits FROM agent_config WHERE biz_id = ? ORDER BY agent_key", bizId)
      .map((a) => ({ agent: a.agent_key, autonomy: a.autonomy, enabled: !!a.enabled, tokenBudgetDay: a.token_budget_day, model: a.limits?.model ?? null })),
    adTemplates: q.all<Row>("SELECT name, platform, definition FROM ad_template WHERE biz_id = ? ORDER BY name", bizId),
    automations: q.all<Row>("SELECT type, name, config, status, rule_id FROM automation WHERE biz_id = ? ORDER BY created_at", bizId)
      .filter((a) => !(a.type === "auto_run" && a.config?.mode === "schedule")) // bound to specific ads of this machine
      .map((a) => {
        // Rule-backed flows keep their exact rule definition (no recompilation → identical behaviour).
        const r = a.rule_id ? q.get<Row>("SELECT description, definition, mode, priority FROM rule WHERE id = ?", a.rule_id) : undefined;
        const def = r ? { ...r.definition, scope: { ...r.definition.scope, filters: (r.definition.scope?.filters ?? []).filter((f: Row) => f.field !== "account") } } : undefined;
        return {
          type: a.type, name: a.name, status: a.status, config: Object.fromEntries(Object.entries(a.config ?? {}).filter(([k]) => !LOCAL_REFS.includes(k))),
          ...(r ? { rule: { description: r.description, definition: def, mode: r.mode, priority: r.priority } } : {}),
        };
      }),
    knowledge: q.all<Row>("SELECT title, kind, source, tags, body FROM knowledge_doc WHERE biz_id = ? ORDER BY created_at", bizId).filter((d) => !SEED_SOURCES.test(d.source)),
    schedules: q.all<Row>("SELECT name, every_minutes, enabled FROM schedule WHERE biz_id = ? ORDER BY name", bizId),
  };
  mkdirSync(dirname(WORKSPACE_FILE), { recursive: true });
  writeFileSync(WORKSPACE_FILE, `${JSON.stringify(snap, null, 2)}\n`);
  return snap;
}

/** Apply a snapshot on top of a freshly seeded workspace (idempotent by names/keys). */
export async function applyWorkspace(bizId: string, file = WORKSPACE_FILE) {
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, "utf8"));
  if (s.biz) update("biz", bizId, { name: s.biz.name, timezone: s.biz.timezone, currency: s.biz.currency });
  if (s.settings) {
    const cur = q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId)!.settings ?? {};
    update("biz", bizId, { settings: { ...cur, ...s.settings, killSwitch: cur.killSwitch, ...(s.settings.llm ? { llm: { ...s.settings.llm, codexAccountId: cur.llm?.codexAccountId ?? null } } : {}) } });
  }
  if (s.dna) {
    const cur = q.get<Row>("SELECT * FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", bizId);
    if (!cur || JSON.stringify(cur.data) !== JSON.stringify(s.dna)) {
      if (cur) update("dna_profile", cur.id, { status: "archived" });
      insert("dna_profile", { biz_id: bizId, version: (cur?.version ?? 0) + 1, status: "active", data: s.dna, created_by: "workspace snapshot" });
    }
  }
  for (const a of s.agents ?? []) {
    const cfg = q.get<Row>("SELECT * FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, a.agent);
    if (cfg) update("agent_config", cfg.id, { autonomy: a.autonomy, enabled: a.enabled ? 1 : 0, token_budget_day: a.tokenBudgetDay, limits: { ...(cfg.limits ?? {}), model: a.model ?? undefined } });
  }
  for (const t of s.adTemplates ?? []) {
    const cur = q.get<Row>("SELECT id FROM ad_template WHERE biz_id = ? AND name = ?", bizId, t.name);
    if (cur) update("ad_template", cur.id, { platform: t.platform, definition: t.definition });
    else insert("ad_template", { biz_id: bizId, name: t.name, platform: t.platform, definition: t.definition });
  }
  ensureAutomations(bizId); // seed rules → automation rows, so names match below
  for (const a of s.automations ?? []) {
    const cur = q.get<Row>("SELECT id, status, rule_id FROM automation WHERE biz_id = ? AND name = ?", bizId, a.name);
    if (a.rule) {
      const ruleStatus = a.status === "paused" ? "paused" : "active";
      let ruleId = cur?.rule_id as string | undefined;
      if (ruleId) update("rule", ruleId, { name: a.name, description: a.rule.description, definition: a.rule.definition, mode: a.rule.mode, priority: a.rule.priority, status: ruleStatus });
      else ruleId = insert("rule", { biz_id: bizId, name: a.name, description: a.rule.description, definition: a.rule.definition, mode: a.rule.mode, status: ruleStatus, version: 1, priority: a.rule.priority }).id;
      if (cur) update("automation", cur.id, { type: a.type, config: a.config, status: a.status, rule_id: ruleId });
      else insert("automation", { biz_id: bizId, type: a.type, name: a.name, config: a.config, status: a.status, rule_id: ruleId, run_count: 0 });
      continue;
    }
    try {
      const saved: Row = await saveAutomation(bizId, { id: cur?.id, type: a.type, name: a.name, config: a.config }, "workspace");
      if (a.status === "paused" && saved.status !== "paused") {
        update("automation", saved.id, { status: "paused" });
        if (saved.rule_id) update("rule", saved.rule_id, { status: "paused" });
      }
    } catch (e) {
      console.warn(`! Bỏ qua luồng "${a.name}": ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const d of s.knowledge ?? []) {
    if (q.get("SELECT id FROM knowledge_doc WHERE biz_id = ? AND title = ?", bizId, d.title)) continue;
    const doc = insert("knowledge_doc", { biz_id: bizId, title: d.title, kind: d.kind, source: d.source, tags: d.tags ?? [], body: d.body, status: "processed" });
    String(d.body).split(/\n+/).map((x) => x.trim()).filter(Boolean).forEach((text, idx) => insert("knowledge_chunk", { biz_id: bizId, doc_id: doc.id, idx, text, source_ref: `${doc.id.slice(-6)}#${idx}` }));
  }
  for (const sc of s.schedules ?? []) q.run("UPDATE schedule SET every_minutes = ?, enabled = ? WHERE biz_id = ? AND name = ?", sc.every_minutes, sc.enabled ? 1 : 0, bizId, sc.name);
  audit(bizId, "system", "workspace.applied", undefined, { file, exportedAt: s.exportedAt });
  return s;
}
