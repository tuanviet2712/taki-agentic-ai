import { useMemo, useState } from "react";
import { BookOpenCheck, FileText, FolderSync, Library, Users } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, timeAgo } from "../lib/format";
import { Badge, Button, Card, Chevron, Collapse, Empty, Loading, Modal, PageHeader, Stat, Toggle, cx, useOpen, useToast } from "../components/ui";

const ROLE = { dna: { label: "DNA", tone: "violet" }, persona: { label: "Vai trò", tone: "blue" }, playbook: { label: "Skill", tone: "green" } } as const;
const kb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K ký tự` : `${n} ký tự`);

/** Skill library: the Marketing department's Claude Code skills + staff, as bound to system agents. */
export function Skills() {
  const { data, reload } = useApi<any>("skills");
  const [open, setOpen] = useState<string | null>(null);
  const [playbookOf, setPlaybookOf] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  const byKey = useMemo(() => Object.fromEntries((data?.skills ?? []).map((s: any) => [s.key, s])), [data]);
  const bindingsByAgent = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const b of data?.bindings ?? []) (m[b.agent_key] ??= []).push(b);
    return m;
  }, [data]);

  if (!data) return <Loading />;
  const totalChars = (data.skills as any[]).reduce((a, s) => a + s.size, 0);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post("skills/sync");
      toast(`Đồng bộ xong: ${r.added.length} mới, ${r.updated.length} cập nhật, ${r.unchanged.length} giữ nguyên${r.missing.length ? `, thiếu ${r.missing.join(", ")}` : ""}`);
      reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setSyncing(false); }
  };
  const toggle = async (agentKey: string, skillKey: string, enabled: boolean) => {
    try { await api.put("agent-skills", { agentKey, skillKey, enabled }); reload(); } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Skill & Nhân viên MKT" subtitle="Skill và nhân viên AI của Phòng Marketing (từ tài khoản Claude Code) được nạp vào từng agent. Agent chạy theo DNA + vai trò + skill này."
        actions={<Button variant="primary" icon={FolderSync} loading={syncing} onClick={sync}>Đồng bộ lại từ ~/.claude</Button>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={Library} tone="blue" label="Skill đã nạp" value={(data.skills as any[]).filter((s) => s.kind === "skill").length} sub={kb(totalChars)} />
        <Stat icon={Users} tone="violet" label="Nhân viên MKT" value={(data.skills as any[]).filter((s) => s.kind === "persona").length} sub="subagent mkt-*" />
        <Stat icon={BookOpenCheck} tone="green" label="Lớp DNA" value={(data.skills as any[]).filter((s) => s.kind === "dna").length} sub="taki-dna + hồ sơ phòng" />
        <Stat icon={FileText} tone="amber" label="Liên kết agent ↔ skill" value={data.bindings.length} sub={<span className="block truncate" title={data.skillsDir}>nguồn: {data.skillsDir}</span>} />
      </div>

      <Card title="Đội ngũ → agent trong hệ thống" bodyClass="p-3 pt-1">
        <div className="divide-y divide-line">
          {data.team.map((t: any) => (
            <TeamRow key={t.label} t={t} bindings={t.agents.slice(0, 1).flatMap((a: string) => (bindingsByAgent[a] ?? []).filter((b) => b.role !== "dna"))}
              hasAny={t.agents.some((a: string) => (bindingsByAgent[a] ?? []).length)} byKey={byKey}
              onOpenSkill={setOpen} onPlaybook={setPlaybookOf} onToggle={(skillKey, v) => t.agents.forEach((a: string) => toggle(a, skillKey, v))} />
          ))}
        </div>
      </Card>

      <Card title="Thư viện skill" collapsible="skills.library" defaultOpen={false} summary={`${data.skills.length} mục · bấm để xem`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2">Skill</th><th>Loại</th><th>Nhóm</th><th>Phiên bản</th><th>Kích thước</th><th>Đồng bộ</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.skills.map((s: any) => (
                <tr key={s.key} className="cursor-pointer hover:bg-soft" onClick={() => setOpen(s.key)}>
                  <td className="py-2.5"><p className="font-medium">{s.key}</p><p className="line-clamp-1 max-w-[420px] text-xs text-muted">{s.description}</p></td>
                  <td><Badge tone={s.kind === "dna" ? "violet" : s.kind === "persona" ? "blue" : "green"}>{s.kind === "dna" ? "DNA" : s.kind === "persona" ? "Nhân viên" : "Skill"}</Badge></td>
                  <td className="text-xs text-muted">{s.grp}</td>
                  <td>v{s.version}</td>
                  <td className="text-xs">{kb(s.size)}</td>
                  <td className="text-xs text-muted">{timeAgo(s.synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Skill vốn viết cho phiên Claude Code tương tác. Khi nạp vào agent, hệ thống giữ phương pháp, công thức, tiêu chí chấm, luật giọng; bỏ các bước hỏi lại, ghi file, gọi công cụ. Sửa skill trong ~/.claude rồi bấm "Đồng bộ lại" để lên phiên bản mới.</p>
      </Card>

      {open && <SkillModal skillKey={open} onClose={() => setOpen(null)} />}
      {playbookOf && <PlaybookModal agentKey={playbookOf} onClose={() => setPlaybookOf(null)} />}
    </div>
  );
}

/** One team, folded by default: the header says who it is and how many skills are on; the list drops down on demand. */
function TeamRow({ t, bindings, hasAny, byKey, onOpenSkill, onPlaybook, onToggle }: { t: any; bindings: any[]; hasAny: boolean; byKey: Record<string, any>; onOpenSkill: (k: string) => void; onPlaybook: (agent: string) => void; onToggle: (skillKey: string, v: boolean) => void }) {
  const [open, toggleOpen] = useOpen(false, `skills.team.${t.label}`);
  const on = bindings.filter((b) => b.enabled).length;
  return (
    <div>
      <button type="button" onClick={() => toggleOpen()} aria-expanded={open} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-soft">
        <Chevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{t.label}</span>
          <span className="block truncate text-xs text-muted">{t.employee ? `Nhân viên: ${t.employee}` : "Bộ skill bán hàng"} → {t.agents.map((a: string) => AGENT_LABEL[a] ?? a).join(", ")}</span>
        </span>
        <Badge tone={on ? "green" : "gray"} className="shrink-0 tabular-nums">{on}/{bindings.length} đang bật</Badge>
      </button>
      <Collapse open={open}>
        <div className="space-y-2 pb-3 pl-9 pr-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {t.agents.map((a: string) => <Button key={a} size="sm" onClick={() => onPlaybook(a)}>Xem prompt{t.agents.length > 1 ? ` · ${AGENT_LABEL[a] ?? a}` : ""}</Button>)}
          </div>
          {!hasAny ? <Empty>Chưa có skill — bấm Đồng bộ.</Empty> : (
            <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
              {bindings.map((b: any) => {
                const s = byKey[b.skill_key];
                return (
                  <div key={b.skill_key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-soft">
                    <button className="min-w-0 flex-1 text-left" onClick={() => onOpenSkill(b.skill_key)} title={b.skill_key}>
                      <span className="flex min-w-0 items-center gap-1.5 text-[13px]"><Badge tone={ROLE[b.role as keyof typeof ROLE].tone} className="px-1.5 text-[10px]">{ROLE[b.role as keyof typeof ROLE].label}</Badge><span className="truncate font-medium">{b.skill_key}</span></span>
                      {s && <span className="block truncate text-[11px] text-muted">v{s.version} · {kb(s.size)}{s.refs_count ? ` · ${s.refs_count} tài liệu` : ""}</span>}
                    </button>
                    <Toggle size="sm" checked={!!b.enabled} onChange={(v) => onToggle(b.skill_key, v)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function SkillModal({ skillKey, onClose }: { skillKey: string; onClose: () => void }) {
  const { data } = useApi<any>(`skills/${skillKey}`);
  const [ref, setRef] = useState<number | null>(null);
  return (
    <Modal open onClose={onClose} wide title={`Skill: ${skillKey}`}>
      {!data ? <Loading /> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{data.description}</p>
          <p className="text-xs text-muted">Nguồn: {data.source_path} · v{data.version} · dùng bởi: {data.usedBy.map((u: any) => AGENT_LABEL[u.agent_key] ?? u.agent_key).join(", ") || "—"}</p>
          {data.refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setRef(null)} className={cx("rounded-full px-2.5 py-1 text-xs", ref == null ? "bg-blue-600 text-white" : "bg-soft")}>SKILL.md</button>
              {data.refs.map((r: any, i: number) => <button key={r.path} onClick={() => setRef(i)} className={cx("rounded-full px-2.5 py-1 text-xs", ref === i ? "bg-blue-600 text-white" : "bg-soft")}>{r.path}</button>)}
            </div>
          )}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-4 text-xs leading-relaxed scroll-thin">{ref == null ? data.body : data.refs[ref].content}</pre>
        </div>
      )}
    </Modal>
  );
}

function PlaybookModal({ agentKey, onClose }: { agentKey: string; onClose: () => void }) {
  const { data } = useApi<any>(`agents/${agentKey}/playbook`);
  return (
    <Modal open onClose={onClose} wide title={`Ngữ cảnh ${AGENT_LABEL[agentKey] ?? agentKey} nhận mỗi lần chạy`}>
      {!data ? <Loading /> : (
        <div className="space-y-3">
          <p className="text-sm">{kb(data.chars)} ≈ {data.approxTokens.toLocaleString("vi-VN")} token, gồm:</p>
          <div className="flex flex-wrap gap-1.5">{data.parts.map((p: any) => <Badge key={p.key} tone={ROLE[p.role as keyof typeof ROLE]?.tone ?? "gray"}>{p.key} v{p.version} · {kb(p.chars)}{p.truncated ? " (rút gọn)" : ""}</Badge>)}</div>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-4 text-xs scroll-thin">{data.preview}{data.chars > 4000 ? "\n…" : ""}</pre>
        </div>
      )}
    </Modal>
  );
}
