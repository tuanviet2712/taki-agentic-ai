// MCP server tối giản (stdio, JSON-RPC theo dòng): công cụ "approve" trả lời hộp hỏi quyền của Claude Code
// (--permission-prompt-tool mcp__taki_approver__approve) khi agent điều khiển Chrome THẬT của Sếp chạy nền.
// Luật (danh sách công cụ, máy chủ, thư mục tệp, script) nằm ở chrome-approver-rules.mjs; cấu hình qua biến môi trường
// TAKI_APPROVER_* trong khối `env` của cấu hình MCP. Mọi quyết định (cho / từ chối) được ghi 1 dòng JSON vào TAKI_APPROVER_LOG.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { configFromEnv, decide } from "./chrome-approver-rules.mjs";

const cfg = configFromEnv(process.env);
const LOG = process.env.TAKI_APPROVER_LOG || "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

/** An allowed action must be auditable when a persistent log is configured. */
function audit(entry) {
  const line = JSON.stringify(entry);
  process.stderr.write(`[approver] ${entry.tool} → ${entry.decision}${entry.reason ? ` (${entry.reason})` : ""}\n`);
  if (!LOG) return true;
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, line + "\n", { mode: 0o600 }); return true; } catch { return false; }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "taki-approver", version: "2.0.0" } } });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: [{ name: "approve", description: "Trả lời hỏi quyền", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" } }, required: ["tool_name"] } }] } });
  if (method === "tools/call") {
    const a = params?.arguments ?? {};
    const toolName = typeof a.tool_name === "string" ? a.tool_name : "";
    let d;
    try { d = decide(toolName, a.input ?? {}, cfg); } catch (e) { d = { behavior: "deny", reason: `lỗi bộ duyệt: ${String(e).slice(0, 80)}` }; }
    const entry = { at: new Date().toISOString(), tool: toolName.replace(/^mcp__claude-in-chrome__/, "chrome."), decision: d.behavior, reason: d.reason, ...(d.host ? { host: d.host } : {}), ...(d.note ? { note: d.note } : {}) };
    if (!audit(entry) && d.behavior === "allow") {
      d = { behavior: "deny", reason: "không ghi được nhật ký quyền Chrome" };
      audit({ ...entry, decision: "deny", reason: d.reason });
    }
    const decision = d.behavior === "allow"
      ? { behavior: "allow", updatedInput: a.input ?? {} }
      : { behavior: "deny", message: `Bị chặn bởi bộ duyệt quyền TAKI: ${d.reason}` };
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
});
