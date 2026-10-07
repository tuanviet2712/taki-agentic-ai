import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, KeyRound, Send, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, PlatformIcon, useToast } from "./ui";

/** Ngân Nguyệt trên Telegram: bot token ở Trung tâm tích hợp → mã ghép nối → Sếp nhắn bot như nhắn trên web. */
export function TelegramAssistantCard() {
  const toast = useToast();
  const { data: d, reload } = useApi<any>("assistant/telegram", ["assistant.", "connection."]);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(k);
    try { await fn(); if (ok) toast(ok); reload(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><PlatformIcon p="telegram" size={20} />Ngân Nguyệt trên Telegram</span>}
      action={d?.connected && <Badge tone={d.error ? "amber" : d.running ? "green" : "gray"}>{d.error ? "Có lỗi" : d.running ? "Đang nhận tin" : "Đang khởi động"}</Badge>}>
      {!d ? null : !d.connected ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted">Nhắn trực tiếp với trợ lý Ngân Nguyệt qua bot Telegram của Sếp — cùng trí nhớ và công cụ như trên web, thẻ cần xác nhận có nút ✅/❌ ngay trong Telegram.</p>
          <ol className="list-decimal space-y-1 pl-5 text-ink">
            <li>Mở <b>Quảng cáo → Trung tâm tích hợp → Telegram</b>, dán <b>Bot token</b> của bot (lấy ở @BotFather → /mybots → API Token). Ô Chat ID có thể để trống.</li>
            <li>Quay lại đây bấm <b>Tạo mã ghép nối</b> rồi mở link để bắt đầu chat.</li>
          </ol>
          <Link to="/ads/integrations?p=telegram"><Button variant="primary" icon={KeyRound}>Mở Trung tâm tích hợp → Telegram</Button></Link>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-ink">Bot: {d.bot ? <a href={`https://t.me/${d.bot.username}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">@{d.bot.username}</a> : "…"}{d.lastPollAt && <span className="text-xs text-muted"> · nhận tin lần cuối {timeAgo(d.lastPollAt)}</span>}</p>
          {d.error && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">{d.error}</p>}
          {d.pair ? (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
              <p className="text-xs text-muted">Mã ghép nối (hết hạn {timeAgo(d.pair.until)})</p>
              <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-ink">{d.pair.code}</p>
              {d.pair.link && <a href={d.pair.link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"><Send className="h-4 w-4" />Mở Telegram để ghép nối<ExternalLink className="h-3.5 w-3.5" /></a>}
              <p className="mt-2 text-xs text-muted">Hoặc nhắn cho bot: <code>/start {d.pair.code}</code>. Chỉ tài khoản Telegram đã ghép nối mới ra lệnh được cho hệ thống.</p>
            </div>
          ) : <Button variant="primary" icon={KeyRound} loading={busy === "pair"} onClick={() => run("pair", () => api.post("assistant/telegram/pair"))}>Tạo mã ghép nối</Button>}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Đã ghép nối ({d.chats.length})</p>
            {d.chats.length === 0 ? <p className="text-muted">Chưa có tài khoản Telegram nào.</p> : (
              <div className="divide-y divide-line rounded-xl border border-line">
                {d.chats.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="min-w-0 flex-1"><b className="text-ink">{c.name}</b><span className="block text-xs text-muted">ghép nối {timeAgo(c.at)}{d.alertsChatId === c.id ? " · nhận cảnh báo hệ thống" : ""}</span></span>
                    <Button size="sm" variant="ghost" icon={Trash2} loading={busy === `rm:${c.id}`} onClick={() => { if (confirm(`Bỏ ghép nối ${c.name}? Tài khoản này sẽ không ra lệnh cho Ngân Nguyệt được nữa.`)) void run(`rm:${c.id}`, () => api.del(`assistant/telegram/chats/${c.id}`), "Đã bỏ ghép nối"); }} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Trong Telegram: nhắn yêu cầu như trên web · <code>/moi</code> cuộc trò chuyện mới · <code>/dung</code> dừng câu trả lời · <code>/trogiup</code>. Lịch sử chat cũng hiện trong khung Ngân Nguyệt trên web (cuộc trò chuyện “Telegram · …”).</p>
        </div>
      )}
    </Card>
  );
}
