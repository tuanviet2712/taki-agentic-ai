/**
 * public-friend-routes.ts — Public API (X-Api-Key) cho KẾT BẠN ZALO từ hệ thống ngoài (TAKI Agentic AI:
 * "chăm khách từ bình luận" → khách để lại SĐT → nick Zalo gửi lời mời kết bạn kèm lời chào).
 *
 *   POST /api/public/friends/lookup-by-phone  { zaloAccountId, phone }            → { found, uid, zaloName }
 *   POST /api/public/friends/request          { zaloAccountId, userId?|phone?, message } → { sent, uid, alreadyFriend, sentMessage }
 *   Lỗi: 503 { code: SESSION_EXPIRED | ZALO_UNAVAILABLE | RATE_LIMITED, message } = tạm thời, thử lại sau;
 *        4xx { code: FRIEND_REQUEST_BLOCKED | ZALO_USER_NOT_FOUND | INVALID_ZALO_USER, message } = Zalo từ chối hẳn.
 *   GET  /api/public/friends/status?zaloAccountId=&userId=                       → { isFriend, status }
 *
 * Tái dùng đúng các thao tác nội bộ (zaloOps.findUser / sendFriendRequest / getFriendRequestStatus + markFriendRequestSent),
 * có rate-limit theo nick của zaloOps. SĐT KHÔNG bao giờ ghi log thô (chỉ hash SHA-256 vào PhoneSearchEvent).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizeVnMobile } from '../../shared/utils/phone.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { markFriendRequestSent } from '../zalo/friend-event-handler.js';
import { apiKeyAuth } from './public-api-routes.js';

const hashPhone = (phone: string) => createHash('sha256').update(phone).digest('hex');

async function ownedAccount(orgId: string, zaloAccountId: unknown) {
  if (typeof zaloAccountId !== 'string' || !zaloAccountId) return null;
  return prisma.zaloAccount.findFirst({ where: { id: zaloAccountId, orgId }, select: { id: true, status: true } });
}

/** Mã lỗi Zalo gốc (ZaloOpError.zaloCode, hoặc ZaloApiError.code chưa bọc, hoặc "[zalo:NNN]" trong message cũ). */
function zaloCodeOf(err: any): number | null {
  if (typeof err?.zaloCode === 'number') return err.zaloCode;
  if (typeof err?.code === 'number') return err.code;
  const m = /\[zalo:(-?\d+)\]/.exec(String(err?.message ?? ''));
  return m ? Number(m[1]) : null;
}

/** Zalo trả 216 = SĐT không có tài khoản Zalo (hoặc ẩn tìm kiếm theo SĐT). */
const ZALO_NO_ACCOUNT = 216;

/**
 * findUser theo SĐT từ góc nhìn 1 nick. CHỈ trả "không có Zalo" khi Zalo trả lời rõ là không có tài khoản
 * (kết quả rỗng / mã 216). Phiên hết hạn, chưa đăng nhập, lỗi mạng, lỗi lạ → ném lại để route trả 503
 * (bên gọi thử lại sau) — tránh chốt nhầm "no_zalo" vĩnh viễn cho khách thật ra có Zalo.
 */
async function lookup(orgId: string, accountId: string, phone: string): Promise<{ uid: string | null; zaloName: string | null }> {
  const logEvent = (result: string, foundUid: string | null, errorCode: string | null) =>
    prisma.phoneSearchEvent.create({ data: { orgId, accountId, userId: null, phoneHash: hashPhone(phone), result, foundUid, errorCode } })
      .catch((e: unknown) => logger.warn(`[public-friends] phone-search-log failed: ${String(e)}`));
  let u: Record<string, unknown>;
  try {
    u = ((await zaloOps.findUser(accountId, phone)) as Record<string, unknown>) || {};
  } catch (err: any) {
    const zc = zaloCodeOf(err);
    if (zc === ZALO_NO_ACCOUNT) {
      await logEvent('no_zalo', null, String(zc));
      return { uid: null, zaloName: null };
    }
    await logEvent(err?.code === 'RATE_LIMITED' ? 'rate_limited' : 'error', null, String(err?.code ?? zc ?? 'UNKNOWN').slice(0, 40));
    throw err;
  }
  const uid = String(u.uid || u.userId || '') || null;
  await logEvent(uid ? 'found_zalo' : 'no_zalo', uid, null);
  return { uid, zaloName: String(u.zaloName || u.zalo_name || u.displayName || u.display_name || '') || null };
}

/** Lỗi Zalo CHẮC CHẮN (từ chối hẳn — gửi lại cũng vô ích) cho thao tác kết bạn → 4xx kèm mã riêng. */
const FRIEND_REJECTIONS: Record<number, { status: number; code: string; message: string }> = {
  215: { status: 403, code: 'FRIEND_REQUEST_BLOCKED', message: 'Khách đã chặn nick này hoặc không nhận lời mời kết bạn' },
  216: { status: 404, code: 'ZALO_USER_NOT_FOUND', message: 'Không tìm thấy tài khoản Zalo này' },
  114: { status: 400, code: 'INVALID_ZALO_USER', message: 'Tài khoản Zalo không hợp lệ' },
};

/**
 * Trả lỗi an toàn cho bên gọi: chỉ mã + câu tiếng Việt, KHÔNG lộ message nội bộ (chi tiết chỉ ghi log server,
 * không có SĐT thô). 503 = tạm thời (SESSION_EXPIRED / ZALO_UNAVAILABLE / RATE_LIMITED) → bên gọi thử lại sau;
 * 4xx = Zalo từ chối hẳn.
 */
function opError(reply: FastifyReply, err: any, label: string) {
  const code = err?.code as string | number | undefined;
  const zc = zaloCodeOf(err);
  logger.warn(`[public-friends] ${label} error: code=${String(code ?? '-')} zalo=${zc ?? '-'} ${String(err?.message ?? err).slice(0, 300)}`);
  const send = (status: number, c: string, message: string) => reply.status(status).send({ error: c, code: c, message });
  if (code === 'SESSION_EXPIRED') return send(503, 'SESSION_EXPIRED', 'Phiên đăng nhập Zalo của nick đã hết hạn — cần đăng nhập lại (quét QR), sẽ thử lại sau');
  if (code === 'NOT_CONNECTED') return send(503, 'SESSION_EXPIRED', 'Nick Zalo đang mất kết nối hoặc chưa đăng nhập — sẽ thử lại sau');
  if (code === 'RATE_LIMITED') return send(503, 'RATE_LIMITED', 'Nick Zalo đang chạm giới hạn tần suất — thử lại sau');
  if (label !== 'lookup' && zc != null && FRIEND_REJECTIONS[zc]) {
    const r = FRIEND_REJECTIONS[zc];
    return send(r.status, r.code, r.message);
  }
  if (code === 'INVALID_PARAMS') return send(400, 'INVALID_PARAMS', 'Yêu cầu không hợp lệ');
  return send(503, 'ZALO_UNAVAILABLE', 'Zalo tạm thời không phản hồi — thử lại sau');
}

export async function publicFriendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);

  app.post('/api/public/friends/lookup-by-phone', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const phone = normalizeVnMobile(typeof body.phone === 'string' ? body.phone : '');
    if (!phone) return reply.status(400).send({ error: 'phone không hợp lệ (di động VN)' });
    const account = await ownedAccount(orgId, body.zaloAccountId);
    if (!account) return reply.status(404).send({ error: 'Zalo account không thuộc tổ chức' });
    try {
      const r = await lookup(orgId, account.id, phone);
      return r.uid ? { found: true, uid: r.uid, zaloName: r.zaloName } : { found: false, uid: null, reason: 'no_zalo' };
    } catch (err) {
      return opError(reply, err, 'lookup');
    }
  });

  app.post('/api/public/friends/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 150) : ''; // Zalo giới hạn lời chào ~150 ký tự
    const account = await ownedAccount(orgId, body.zaloAccountId);
    if (!account) return reply.status(404).send({ error: 'Zalo account không thuộc tổ chức' });
    let uid = typeof body.userId === 'string' && body.userId ? body.userId : null;
    try {
      if (!uid) {
        const phone = normalizeVnMobile(typeof body.phone === 'string' ? body.phone : '');
        if (!phone) return reply.status(400).send({ error: 'cần userId hoặc phone hợp lệ' });
        uid = (await lookup(orgId, account.id, phone)).uid;
        if (!uid) return reply.send({ sent: false, uid: null, reason: 'no_zalo' });
      }
      const existing = await prisma.friend.findUnique({
        where: { zaloAccountId_zaloUidInNick: { zaloAccountId: account.id, zaloUidInNick: uid } },
        select: { friendshipStatus: true },
      });
      if (existing?.friendshipStatus === 'accepted') return reply.send({ sent: false, uid, alreadyFriend: true });
      if (existing?.friendshipStatus === 'pending_sent') return reply.send({ sent: true, uid, alreadyPending: true, sentMessage: null });
      try {
        await zaloOps.sendFriendRequest(account.id, message, uid);
      } catch (err) {
        const zc = zaloCodeOf(err);
        // 225 = đã là bạn; 222 = khách đã gửi lời mời cho nick trước → Zalo coi như đồng ý → giờ là bạn.
        if (zc === 225 || zc === 222) return reply.send({ sent: false, uid, alreadyFriend: true, sentMessage: null });
        throw err;
      }
      await markFriendRequestSent(account.id, uid).catch((e: unknown) => logger.warn(`[public-friends] markFriendRequestSent failed: ${String(e)}`));
      // sentMessage = đúng lời chào đã gửi (đã cắt 150 ký tự) để bên gọi lưu đúng nội dung khách nhận.
      return reply.status(201).send({ sent: true, uid, sentMessage: message });
    } catch (err) {
      return opError(reply, err, 'request');
    }
  });

  app.get('/api/public/friends/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const { zaloAccountId, userId } = (request.query ?? {}) as Record<string, string | undefined>;
    if (!userId) return reply.status(400).send({ error: 'userId bắt buộc' });
    const account = await ownedAccount(orgId, zaloAccountId);
    if (!account) return reply.status(404).send({ error: 'Zalo account không thuộc tổ chức' });
    const row = await prisma.friend.findUnique({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId: account.id, zaloUidInNick: userId } },
      select: { friendshipStatus: true },
    });
    if (row?.friendshipStatus === 'accepted') return { isFriend: true, status: 'accepted' };
    // Bảng Friend cập nhật qua sự kiện listener; hỏi thẳng Zalo để không lỡ khi listener mất kết nối.
    try {
      const st = (await zaloOps.getFriendRequestStatus(account.id, userId)) as Record<string, unknown> | null;
      if (st && (st.is_friend === 1 || st.is_friend === true)) return { isFriend: true, status: 'accepted' };
      return { isFriend: false, status: row?.friendshipStatus ?? (st?.is_requested ? 'pending_sent' : 'none') };
    } catch (err) {
      if (row) return { isFriend: false, status: row.friendshipStatus };
      return opError(reply, err, 'status');
    }
  });
}
