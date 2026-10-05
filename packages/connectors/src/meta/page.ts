import type { Connector, FeedComment, MessengerSyncMessage, MessengerThread } from "../index.ts";
import { graphGet, graphPost, graphUpload } from "./graph.ts";

/**
 * Facebook Page publisher / reader with the PAGE token (from a System User or user token's me/accounts).
 * Ported from AI Affiliate OS (metaPageConnector), on top of this repo's Graph transport (Bearer header,
 * HTTP-200 error blocks, writes never retried). Needs pages_manage_posts / pages_read_engagement; Messenger needs
 * pages_messaging; replies to comments need pages_manage_engagement.
 */
const MSG_FIELDS = "id,message,from,to,created_time,attachments";

function normMessage(m: any, pageId: string): MessengerSyncMessage | null {
  if (!m?.id || !m.created_time) return null;
  const hasAttachment = Array.isArray(m.attachments?.data) ? m.attachments.data.length > 0 : Boolean(m.attachments);
  const text = String(m.message ?? "").trim() || (hasAttachment ? "[Ảnh/tệp đính kèm]" : "");
  if (!text) return null;
  return { mid: String(m.id), text, fromPage: String(m.from?.id ?? "") === String(pageId), createdTime: new Date(m.created_time).toISOString(), hasAttachment };
}
function normThread(t: any, pageId: string): MessengerThread | null {
  const other = ((t?.participants?.data ?? []) as any[]).find((p) => p?.id && String(p.id) !== String(pageId));
  if (!t?.id || !other) return null;
  const messages = ((t.messages?.data ?? []) as any[]).map((m) => normMessage(m, pageId)).filter((m): m is MessengerSyncMessage => Boolean(m));
  return {
    threadId: String(t.id), updatedTime: new Date(t.updated_time ?? messages[0]?.createdTime ?? Date.now()).toISOString(),
    customer: { psid: String(other.id), name: other.name ? String(other.name) : null },
    messages, hasMoreMessages: Boolean(t.messages?.paging?.next),
  };
}

export function metaPageConnector(pageToken: string, pageId: string): Connector {
  return {
    platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
    async health() {
      const p = await graphGet(pageToken, pageId, { fields: "id,name" });
      return { ok: true, detail: `Fanpage ${p.name ?? pageId}` };
    },
    async publishPost(spec) {
      // Video → /videos (graph-video upload); image → /photos; text/link → /feed.
      if (spec.media?.mime.startsWith("video/")) {
        const r = await graphUpload(pageToken, `${spec.channelExternalId}/videos`, { description: spec.text, published: "true" }, spec.media, true);
        const id = String(r.id);
        return { externalId: id, permalink: `https://www.facebook.com/${spec.channelExternalId}/videos/${id}` };
      }
      if (spec.media?.mime.startsWith("image/")) {
        const r = await graphUpload(pageToken, `${spec.channelExternalId}/photos`, { caption: spec.text, published: "true" }, spec.media);
        const id = String(r.post_id ?? r.id);
        return { externalId: id, permalink: `https://www.facebook.com/${id}` };
      }
      const r = await graphPost(pageToken, `${spec.channelExternalId}/feed`, { message: spec.text });
      const id = String(r.id);
      return { externalId: id, permalink: `https://www.facebook.com/${id}` };
    },
    async uploadDraft(spec) {
      // Unpublished video: the CEO publishes / schedules it from Meta Business Suite.
      const r = await graphUpload(pageToken, `${spec.channelExternalId}/videos`, { description: spec.caption, published: "false" }, { path: spec.videoPath, mime: "video/mp4" }, true);
      return { externalId: String(r.id), draftUrl: "https://business.facebook.com/latest/content_calendar" };
    },
    async verifyPost(externalId) {
      await graphGet(pageToken, externalId, { fields: "id" });
      return true;
    },
    async postComment(spec) {
      const r = await graphPost(pageToken, `${spec.postExternalId}/comments`, { message: spec.text });
      return { externalId: String(r.id), permalink: r.permalink_url ? String(r.permalink_url) : undefined };
    },
    async fetchPostMetrics(post) {
      const [p, ins] = await Promise.all([
        graphGet(pageToken, post.externalId, { fields: "reactions.summary(true),comments.summary(true),shares" }),
        graphGet(pageToken, `${post.externalId}/insights`, { metric: "post_impressions_unique" }).catch(() => ({ data: [] })),
      ]);
      return {
        reach: Number(ins.data?.find((m: any) => m.name === "post_impressions_unique")?.values?.[0]?.value ?? 0),
        reactions: Number(p.reactions?.summary?.total_count ?? 0),
        comments: Number(p.comments?.summary?.total_count ?? 0),
        shares: Number(p.shares?.count ?? 0),
        saves: 0, // Graph does not return saves for Page posts
      };
    },
    async sendMessage(spec) {
      // Messenger Send API, recipient = PSID, inside the 24h window (messaging_type RESPONSE).
      const r = await graphPost(pageToken, `${pageId}/messages`, { recipient: { id: spec.conversationExternalId }, messaging_type: "RESPONSE", message: { text: spec.text } });
      return { externalId: String(r.message_id ?? r.recipient_id ?? "sent") };
    },
    async replyToComment(spec) {
      const r = await graphPost(pageToken, `${spec.commentExternalId}/comments`, { message: spec.text });
      return { externalId: String(r.id) };
    },
    async privateReply(spec) {
      const r = await graphPost(pageToken, `${pageId}/messages`, { recipient: { comment_id: spec.commentExternalId }, message: { text: spec.text } });
      return { recipientId: String(r.recipient_id ?? ""), messageId: String(r.message_id ?? "") };
    },
    async listComments(spec) {
      const sinceUnix = spec.since ? Math.floor(new Date(spec.since).getTime() / 1000) : undefined;
      const r = await graphGet(pageToken, `${spec.postExternalId}/comments`, {
        fields: "id,from{id,name},message,created_time,parent{id}", filter: "stream", order: "reverse_chronological", limit: 100,
        ...(sinceUnix ? { since: String(sinceUnix) } : {}),
      });
      return ((r.data ?? []) as any[]).map((c): FeedComment => ({
        commentId: String(c.id), postId: spec.postExternalId, parentId: c.parent?.id ? String(c.parent.id) : null,
        fromId: c.from?.id ? String(c.from.id) : null, fromName: c.from?.name ? String(c.from.name) : null,
        message: String(c.message ?? ""), createdTime: c.created_time ? new Date(c.created_time).toISOString() : null,
      }));
    },
    async listPagePosts(spec) {
      const sinceUnix = spec.since ? Math.floor(new Date(spec.since).getTime() / 1000) : undefined;
      const r = await graphGet(pageToken, `${spec.pageId}/posts`, { fields: "id,message,permalink_url,created_time", limit: Math.min(100, spec.limit), ...(sinceUnix ? { since: String(sinceUnix) } : {}) });
      return ((r.data ?? []) as any[]).map((p) => ({
        id: String(p.id), message: p.message ? String(p.message) : null, permalink: p.permalink_url ? String(p.permalink_url) : null,
        createdTime: p.created_time ? new Date(p.created_time).toISOString() : null,
      }));
    },
    async listConversations(spec) {
      const out: MessengerThread[] = [];
      let r = await graphGet(pageToken, `${spec.pageId}/conversations`, { platform: "messenger", fields: `id,updated_time,participants,messages.limit(25){${MSG_FIELDS}}`, limit: Math.min(25, spec.limit) });
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        let older = false;
        for (const t of (r.data ?? []) as any[]) {
          const thread = normThread(t, spec.pageId);
          if (!thread) continue;
          if (spec.since && thread.updatedTime < spec.since) { older = true; break; }
          out.push(thread);
          if (out.length >= spec.limit) return out;
        }
        if (older || !r.paging?.next) break;
        r = await graphGet(pageToken, r.paging.next);
      }
      return out;
    },
    async listConversationMessages(threadId, spec) {
      const out: MessengerSyncMessage[] = [];
      let r = await graphGet(pageToken, `${threadId}/messages`, { fields: MSG_FIELDS, limit: Math.min(25, spec.limit) });
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        for (const m of (r.data ?? []) as any[]) {
          const msg = normMessage(m, spec.pageId);
          if (!msg) continue;
          if (spec.since && msg.createdTime < spec.since) return out;
          out.push(msg);
          if (out.length >= spec.limit) return out;
        }
        if (!r.paging?.next) break;
        r = await graphGet(pageToken, r.paging.next);
      }
      return out;
    },
  };
}
