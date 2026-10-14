/**
 * ZaloAccountPool — singleton that manages live Zalo SDK instances.
 * Handles QR login, session reconnect, message listener lifecycle,
 * and credential persistence to the database.
 *
 * Note: zca-js is imported via createRequire because its TypeScript
 * declarations don't expose named exports in ESM mode.
 */
import { createRequire } from 'module';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { attachZaloListener, type UserInfoCacheEntry } from './zalo-listener-factory.js';
import { emitWebhook } from '../api/webhook-service.js';
import { startMessageSync, stopMessageSync } from './zalo-message-sync.js';
import { backfillIfEmpty } from './zalo-history-backfill.js';
import { readFile } from 'fs/promises';
import { imageSize } from 'image-size';
import { withProxy } from './proxy-util.js';
import { writeTransition, type ZaloStatus, type StatusReason } from './status-log-service.js';

// zca-js has no reliable ESM type exports — load via CJS interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Zalo } = require('zca-js') as { Zalo: new (opts: { logging: boolean; selfListen?: boolean; imageMetadataGetter?: (path: string) => Promise<{ width: number; height: number; size: number }> }) => any };

async function imageMetadataGetter(filePath: string) {
  const data = await readFile(filePath);
  const info = imageSize(data);
  if (!info.width || !info.height) throw new Error(`Cannot read image size: ${filePath}`);
  return { width: info.width, height: info.height, size: data.length };
}

interface ZaloCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

interface ZaloInstance {
  zalo: any;
  api: any;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  displayName?: string;
  zaloUid?: string;
  lastActivity: Date;
}

// Map zaloPool status → ZaloStatus enum cho status log.
// 'connecting' không được log (intermediate, không count vào uptime).
function mapToLogStatus(status: string): ZaloStatus | null {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'qr_pending') return 'qr_pending';
  if (status === 'auth_failed') return 'auth_failed';
  if (status === 'expired') return 'expired';
  return null; // 'connecting' và các status khác → skip
}

// Default reason cho mỗi status nếu caller không truyền context cụ thể.
function defaultReason(status: ZaloStatus): StatusReason {
  switch (status) {
    case 'connected': return 'login';
    case 'disconnected': return 'disconnect';
    case 'qr_pending': return 'session_expired';
    case 'auth_failed': return 'auth_fail';
    case 'expired': return 'session_expired';
  }
}

class ZaloAccountPool {
  private instances = new Map<string, ZaloInstance>();
  private io: Server | null = null;
  // Shared user-info cache passed into each listener context
  private userInfoCache = new Map<string, UserInfoCacheEntry>();
  // Circuit breaker: track disconnect timestamps per account
  private disconnectHistory = new Map<string, number[]>();
  // Accounts manually disabled — suppress auto-reconnect
  private manuallyDisabled = new Set<string>();
  // Accounts with a reconnect currently in flight — prevents concurrent reconnect
  // races (listener 'closed' 30s timer, 2-min retry, 5-min health-check, daily
  // refresh can all fire for the same account at once → stacked listeners).
  private reconnecting = new Set<string>();
  // Accounts đang có 1 CHUỖI auto-reconnect backoff chạy (qua ensureReconnecting).
  // Đảm bảo startup + health-check 5' + listener onDisconnected chỉ tạo tối đa 1 chuỗi
  // / account → không chồng nhiều chuỗi retry. Khác `reconnecting` (khoá 1 lần login).
  private autoReconnectActive = new Set<string>();
  // Đang tắt server (SIGTERM) — chặn mọi auto-reconnect khi listener 'closed' do ta
  // chủ động stop, để Zalo nhận close frame sạch và giải phóng session.
  private shuttingDown = false;
  // Phiên đăng nhập QR đang chờ quét, theo account. `withProxy` giữ khoá toàn cục suốt lúc chờ quét và zca-js tự
  // tạo lại QR khi hết hạn (retry) KHÔNG giới hạn → một phiên bị bỏ quên (đóng hộp thoại, bấm lại) giữ khoá mãi,
  // mọi lần "Đăng nhập QR" sau đó đứng chờ khoá và không bao giờ ra QR. Vì vậy: mỗi phiên bị chặn thời gian,
  // bị huỷ khi bấm lại hoặc khi đóng hộp thoại.
  private qrSessions = new Map<string, { abort: (() => unknown) | null; cancelled: boolean; timer: NodeJS.Timeout }>();

  /** Huỷ phiên QR đang chờ của 1 account (nhả khoá proxy). Trả true nếu có phiên bị huỷ. */
  cancelQR(accountId: string): boolean {
    const session = this.qrSessions.get(accountId);
    if (!session) return false;
    session.cancelled = true;
    clearTimeout(session.timer);
    this.qrSessions.delete(accountId);
    try { session.abort?.(); } catch { /* đã kết thúc */ }
    logger.info(`[zalo:${accountId}] QR login session cancelled`);
    return true;
  }

  setIO(io: Server): void {
    this.io = io;
  }

  /**
   * Graceful shutdown — stop TẤT CẢ listener (gửi close frame tới Zalo) + message sync
   * trước khi process exit. Quan trọng: nếu process bị giết đột ngột (SIGKILL), Zalo
   * server vẫn giữ session cũ ~vài phút → container mới login lại bị từ chối ngay
   * (reconnect_failed → kẹt qr_pending). Stop listener sạch giúp Zalo giải phóng session
   * → restart sau reconnect được ngay. Gọi từ SIGTERM/SIGINT handler.
   */
  shutdownAll(): void {
    this.shuttingDown = true;
    let stopped = 0;
    for (const [accountId, instance] of this.instances) {
      try { instance.api?.listener?.stop(); stopped++; } catch (err) {
        logger.warn(`[zalo:${accountId}] shutdown stop listener error:`, err);
      }
      stopMessageSync(accountId);
    }
    this.instances.clear();
    logger.info(`[zalo-pool] Graceful shutdown: stopped ${stopped} listener(s)`);
  }

  /** Accessor cho module ngoài (friend-sync-service, ...) cần emit socket
   *  mà không cần register listener — dùng zaloPool như central IO registry. */
  getIO(): Server | null {
    return this.io;
  }

  // Initiate QR-based login; emits QR events to frontend via Socket.IO
  async loginQR(accountId: string, proxyUrl?: string | null): Promise<void> {
    this.manuallyDisabled.delete(accountId);
    // Phiên QR cũ (nếu còn) phải nhả khoá trước, nếu không lượt này sẽ đứng chờ khoá mãi.
    this.cancelQR(accountId);
    // Stop any previous listener/sync before replacing the instance (anti-leak).
    this.teardownInstance(accountId);
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'qr_pending', lastActivity: new Date() });

    const QR_SESSION_MS = Number(process.env.ZALO_QR_SESSION_MS) || 3 * 60_000;
    let timedOut = false;
    const session: { abort: (() => unknown) | null; cancelled: boolean; timer: NodeJS.Timeout } = {
      abort: null,
      cancelled: false,
      timer: setTimeout(() => {
        if (this.qrSessions.get(accountId) !== session) return;
        timedOut = true;
        this.cancelQR(accountId);
      }, QR_SESSION_MS),
    };
    this.qrSessions.set(accountId, session);

    try {
      const api: any = await withProxy(proxyUrl, () => zalo.loginQR({}, (event: any) => {
        if (event.actions?.abort) session.abort = event.actions.abort;
        // Bị huỷ khi còn đang xếp hàng chờ khoá / chưa có hàm abort → dừng ngay ở sự kiện đầu tiên.
        if (session.cancelled) { try { event.actions?.abort?.(); } catch { /* đã kết thúc */ } return; }
        switch (event.type) {
          case 0: // QRCodeGenerated
            this.io?.to(`account:${accountId}`).emit('zalo:qr', { accountId, qrImage: event.data.image });
            break;
          case 1: // QRCodeExpired
            this.io?.to(`account:${accountId}`).emit('zalo:qr-expired', { accountId });
            event.actions?.retry();
            break;
          case 2: // QRCodeScanned
            this.io?.to(`account:${accountId}`).emit('zalo:scanned', {
              accountId,
              displayName: event.data.display_name,
              avatar: event.data.avatar,
            });
            break;
          case 4: // GotLoginInfo
            this.saveCredentials(accountId, {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent,
            });
            break;
        }
      }));

      clearTimeout(session.timer);
      if (this.qrSessions.get(accountId) === session) this.qrSessions.delete(accountId);
      let activeAccountId = accountId;
      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Check if an archived account with the same zaloUid exists — restore it
      const archivedAccount = await prisma.zaloAccount.findFirst({
        where: { zaloUid: String(ownId), archivedAt: { not: null }, purged: false, id: { not: accountId } },
        select: { id: true },
      });
      if (archivedAccount) {
        logger.info(`[zalo:${accountId}] Found archived account ${archivedAccount.id} with same zaloUid — restoring`);
        // Transfer session to archived account + unarchive
        const currentAccount = await prisma.zaloAccount.findUnique({
          where: { id: accountId },
          select: { sessionData: true, proxyUrl: true },
        });
        await prisma.zaloAccount.update({
          where: { id: archivedAccount.id },
          data: {
            archivedAt: null,
            status: 'connected',
            sessionData: currentAccount?.sessionData ?? undefined,
            zaloUid: String(ownId),
            lastConnectedAt: new Date(),
          },
        });
        // Delete the new empty account
        await prisma.zaloAccount.delete({ where: { id: accountId } }).catch(() => {});
        // Switch pool instance to old account ID
        this.instances.delete(accountId);
        this.instances.set(archivedAccount.id, instance);
        activeAccountId = archivedAccount.id;
      }

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: activeAccountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(activeAccountId, api);
      this.io?.emit('zalo:connected', { accountId: activeAccountId, zaloUid: ownId });
      await this.updateAccountDB(activeAccountId, 'connected', ownId, 'qr_scan');
      prisma.zaloAccount.findUnique({ where: { id: activeAccountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId: activeAccountId }))
        .catch(() => {});

      this.backfillOrphanedConversations(activeAccountId, api).catch((err) => {
        logger.warn(`[zalo:${activeAccountId}] Backfill orphaned conversations failed:`, err);
      });

      backfillIfEmpty(api, activeAccountId).catch((err) => {
        logger.warn(`[zalo:${activeAccountId}] Initial history backfill failed:`, err);
      });

      this.autoSyncOnConnect(activeAccountId);
    } catch (err) {
      clearTimeout(session.timer);
      if (this.qrSessions.get(accountId) === session) this.qrSessions.delete(accountId);
      // Chỉ đụng tới instance của CHÍNH phiên này: nếu đã bị phiên QR mới thay thế thì giữ nguyên bản mới.
      const instance = this.instances.get(accountId);
      if (instance && instance.zalo === zalo) instance.status = 'disconnected';
      if (timedOut) {
        this.io?.emit('zalo:error', { accountId, error: 'Phiên quét QR đã hết hạn — bấm tạo QR lại' });
      } else if (!session.cancelled) {
        // Huỷ chủ động (bấm lại / đóng hộp thoại) thì im lặng; lỗi thật mới báo lên giao diện.
        this.io?.emit('zalo:error', { accountId, error: String(err) });
      }
      throw err;
    }
  }

  // Reconnect using previously saved session credentials
  /**
   * Reconnect 1 account bằng session đã lưu.
   * @returns true nếu sau lời gọi này account đang `connected`; false nếu thất bại
   *          (login bị từ chối / mạng lỗi) hoặc bị skip do đang reconnect.
   *          KHÔNG throw — mọi lỗi nuốt nội bộ. Callers cũ ignore giá trị trả về nên
   *          việc thêm return boolean là backward-compatible; autoReconnect dùng nó
   *          để quyết định có retry (backoff) hay không.
   */
  async reconnect(accountId: string, credentials: ZaloCredentials, proxyUrl?: string | null): Promise<boolean> {
    // In-flight guard: drop duplicate reconnects for the same account so we never
    // spin up two parallel zca-js sessions/listeners.
    if (this.reconnecting.has(accountId)) {
      logger.info(`[zalo:${accountId}] Reconnect already in progress — skipping duplicate`);
      // Trả status hiện tại: nếu lần đang chạy đã connected → true (caller khỏi retry);
      // còn 'connecting' → false, autoReconnect sẽ hẹn 1 lần kiểm tra lại (no-op nếu OK).
      return this.instances.get(accountId)?.status === 'connected';
    }
    this.reconnecting.add(accountId);
    this.manuallyDisabled.delete(accountId);
    // Stop the previous listener/sync before replacing the instance (anti-leak).
    this.teardownInstance(accountId);
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'connecting', lastActivity: new Date() });

    let step = 'login'; // theo dõi bước fail để log chẩn đoán (login vs getOwnId vs ...)
    try {
      const api: any = await withProxy(proxyUrl, () => zalo.login({
        cookie: credentials.cookie,
        imei: credentials.imei,
        userAgent: credentials.userAgent,
      }));

      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      // getOwnId hay fail thoáng qua khi mạng Zalo storm (fetch failed) — retry 1 lần
      // để KHÔNG vứt bỏ 1 phiên login VỪA THÀNH CÔNG (login OK nhưng getOwnId hụt
      // → trước đây cả reconnect bị coi là fail → kẹt qr_pending oan).
      step = 'getOwnId';
      let ownId: string;
      try {
        ownId = await api.getOwnId();
      } catch (e1) {
        logger.warn(`[zalo:${accountId}] getOwnId lỗi lần 1 (${(e1 as Error)?.message}), thử lại sau 1.5s...`);
        await new Promise((r) => setTimeout(r, 1500));
        ownId = await api.getOwnId();
      }
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(accountId, api);
      await this.updateAccountDB(accountId, 'connected', ownId, 'reconnect_ok');
      this.io?.emit('zalo:connected', { accountId, zaloUid: ownId });
      prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId }))
        .catch(() => {});

      // Fire-and-forget: link orphaned conversations on reconnect
      this.backfillOrphanedConversations(accountId, api).catch((err) => {
        logger.warn(`[zalo:${accountId}] Backfill orphaned conversations failed:`, err);
      });

      // Fire-and-forget: pull Zalo labels sau reconnect — bắt kịp thay đổi label
      // mà user thực hiện trên Zalo Real lúc CRM offline.
      this.autoSyncOnConnect(accountId);
      return true;
    } catch (err: any) {
      const instance = this.instances.get(accountId);
      if (instance) instance.status = 'disconnected';
      // LOG lý do THẬT (trước đây nuốt im → không chẩn đoán được vì sao reconnect fail).
      // step cho biết hụt ở đâu; err.code là Zalo error_code nếu bị server từ chối.
      const zCode = err?.code != null ? ` [zalo:${err.code}]` : '';
      logger.warn(`[zalo:${accountId}] Reconnect FAILED tại step=${step}: ${err?.name || 'Error'}: ${err?.message || String(err)}${zCode}`);
      await this.updateAccountDB(accountId, 'qr_pending', null, 'reconnect_failed');
      this.io?.emit('zalo:reconnect-failed', { accountId, error: String(err) });
      return false;
    } finally {
      this.reconnecting.delete(accountId);
    }
  }

  /** Pull friends + aliases + labels cho account vừa connect via syncAccountFully wrapper.
   *  Fire-and-forget — 3 nhánh parallel trong wrapper. Errors logged, không throw. */
  private autoSyncOnConnect(accountId: string): void {
    void (async () => {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { orgId: true },
      });
      if (!account) return;
      const { syncAccountFully } = await import('./friend-sync-service.js');
      const res = await syncAccountFully(accountId, account.orgId, {
        trigger: 'connect',
        io: this.io,
      });
      logger.info(
        `[zalo:${accountId}] Auto-sync on connect: friends_emitted=${res.friends?.emittedCount ?? 0} aliases=${res.aliasesUpdated} labels=${res.labelsUpdated} errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        logger.warn(`[zalo:${accountId}] Auto-sync errors: ${res.errors.join(' | ')}`);
      }
    })();
  }

  /** Stop the listener + message-sync of any existing live instance for this account
   *  BEFORE it is replaced. zca-js listeners start with retryOnClose:true, so a
   *  previous listener keeps its websocket alive and re-fires handlers forever unless
   *  explicitly stopped — leaking sockets + duplicating message/reaction writes on
   *  every reconnect. Does NOT delete the map entry (caller overwrites it). */
  private teardownInstance(accountId: string): void {
    const existing = this.instances.get(accountId);
    if (existing?.api?.listener) {
      try { existing.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping previous listener:`, err);
      }
    }
    stopMessageSync(accountId);
  }

  // Delegate listener setup to zalo-listener-factory
  private attachListener(accountId: string, api: any): void {
    // Capture the instance this listener belongs to. If the account's instance is
    // later replaced (reconnect) or removed (disconnect/refresh), this stale callback
    // must do nothing — otherwise it corrupts the new instance's status and schedules
    // a redundant reconnect.
    const ownInstance = this.instances.get(accountId);
    attachZaloListener({
      accountId,
      api,
      io: this.io,
      userInfoCache: this.userInfoCache,
      onDisconnected: (id) => {
        // Đang shutdown — ta chủ động stop listener, không reconnect/ghi transition.
        if (this.shuttingDown) return;
        // Stale-callback guard: instance replaced/removed since this listener attached.
        if (this.instances.get(id) !== ownInstance) return;
        // If manually disabled, skip all reconnect logic
        if (this.manuallyDisabled.has(id)) return;

        const inst = this.instances.get(id);
        if (inst) inst.status = 'disconnected';
        this.updateAccountDB(id, 'disconnected', null, 'disconnect');
        stopMessageSync(id);
        // Emit webhook for disconnect (fire-and-forget)
        prisma.zaloAccount.findUnique({ where: { id }, select: { orgId: true } })
          .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.disconnected', { accountId: id }))
          .catch(() => {});

        // Circuit breaker: track disconnect count per account
        const now = Date.now();
        const key = `dc_${id}`;
        const history = (this.disconnectHistory.get(key) || []).filter(t => now - t < 5 * 60_000);
        history.push(now);
        this.disconnectHistory.set(key, history);

        if (history.length >= 5) {
          // >5 disconnects in 5 min → stop reconnecting, require QR re-login
          logger.error(`[zalo:${id}] Circuit breaker: ${history.length} disconnects in 5 min — stopping auto-reconnect. QR re-login required.`);
          this.updateAccountDB(id, 'qr_pending', null, 'session_expired');
          this.io?.emit('zalo:reconnect-failed', { accountId: id, error: 'Session không ổn định, cần đăng nhập QR lại' });
          this.disconnectHistory.delete(key);
          return; // DON'T reconnect
        }

        // Normal auto-reconnect after 30 seconds (qua ensureReconnecting → chuỗi backoff)
        setTimeout(() => this.ensureReconnecting(id), 30_000);
      },
    });

    // Start periodic group message sync backup
    startMessageSync(api, accountId);
  }

  // Persist session credentials to DB
  private saveCredentials(accountId: string, credentials: ZaloCredentials): void {
    prisma.zaloAccount
      .update({ where: { id: accountId }, data: { sessionData: credentials as any } })
      .catch((err) => logger.error(`[zalo:${accountId}] saveCredentials error:`, err));
  }

  // Sync account status and zaloUid to DB
  // Anh chốt 2026-05-22: kèm ghi ZaloAccountStatusLog transition cho uptime tracking.
  // Optional `reason` để phân biệt context (login / reconnect_ok / disconnect / auth_fail).
  // Mặc định map theo status nếu không truyền.
  private async updateAccountDB(
    accountId: string,
    status: string,
    zaloUid: string | null,
    reason?: StatusReason,
  ): Promise<void> {
    try {
      const updated = await prisma.zaloAccount.update({
        where: { id: accountId },
        data: {
          status,
          ...(zaloUid !== null ? { zaloUid } : {}),
          ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}),
        },
        select: { orgId: true },
      });

      // Status log: chỉ ghi khi status thuộc enum ZaloStatus. Skip 'connecting' (intermediate).
      const logStatus = mapToLogStatus(status);
      if (logStatus) {
        const logReason: StatusReason = reason ?? defaultReason(logStatus);
        // Fire-and-forget — không block updateAccountDB nếu status log lỗi.
        void writeTransition({
          accountId,
          orgId: updated.orgId,
          status: logStatus,
          reason: logReason,
        });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  // Auto-reconnect using saved session from DB.
  // Backoff giữa các lần thử trong 1 chuỗi. Hết mảng → chuỗi kết thúc; health-check 5'
  // sẽ khởi 1 chuỗi mới nếu vẫn chưa lên → tổng thể thử rất dày, tự bắt "lúc Zalo chịu nhận".
  private static readonly AUTO_RECONNECT_BACKOFF_MS = [60_000, 120_000, 300_000, 300_000, 300_000];

  /**
   * Điểm vào DUY NHẤT để "kéo 1 nick lên lại" — idempotent. Gọi từ startup, health-check
   * (5'/lần) và listener onDisconnected. Nếu đã có chuỗi đang chạy / đang connect / đang
   * login (qr_pending/connecting) → no-op. Ngược lại bắt đầu 1 chuỗi autoReconnect có backoff.
   *
   * VÌ SAO (2026-06-20): manual Reconnect và auto gọi CÙNG `reconnect()`; auto "fail" còn
   * manual "được" chỉ do thời điểm — Zalo lúc nhận lúc từ chối session. Trước đây auto chỉ
   * thử mỗi 5' (health-check) hoặc 1 lần lúc startup → dễ trượt "lúc Zalo chịu nhận", user
   * phải bấm tay. Giờ mọi trigger đều vào chuỗi backoff 60/120/300s → thử dày như bấm tay
   * liên tục, tự bắt được good-moment mà không cần can thiệp.
   */
  ensureReconnecting(accountId: string): void {
    if (this.manuallyDisabled.has(accountId)) return;
    if (this.autoReconnectActive.has(accountId)) return; // đã có chuỗi đang chạy
    const st = this.instances.get(accountId)?.status;
    if (st === 'connected' || st === 'connecting' || st === 'qr_pending') return; // đang ok / đang login
    this.autoReconnectActive.add(accountId);
    void this.autoReconnect(accountId, 1);
  }

  /**
   * 1 chuỗi auto-reconnect có backoff. KHÔNG gọi trực tiếp — luôn vào qua ensureReconnecting
   * (nó set cờ autoReconnectActive). Cờ giữ suốt chuỗi, chỉ xoá ở trạng thái kết thúc
   * (connected / hết session / bỏ cuộc / manuallyDisabled) để chuỗi mới có thể khởi sau.
   */
  private async autoReconnect(accountId: string, attempt = 1): Promise<void> {
    const finish = () => { this.autoReconnectActive.delete(accountId); };

    // Skip if manually disabled via disconnect/disable action
    if (this.manuallyDisabled.has(accountId)) return finish();
    // Skip if already reconnected (chuỗi khác / manual đã lo xong)
    if (this.instances.get(accountId)?.status === 'connected') return finish();

    const account = await prisma.zaloAccount
      .findUnique({ where: { id: accountId }, select: { sessionData: true, proxyUrl: true } })
      .catch(() => null);
    const session = account?.sessionData as ZaloCredentials | null;
    if (!session?.imei) {
      logger.warn(`[zalo:${accountId}] No saved session, cannot auto-reconnect`);
      this.io?.emit('zalo:reconnect-failed', { accountId, error: 'No saved session' });
      return finish(); // cần QR — không retry vô ích
    }

    logger.info(`[zalo:${accountId}] Auto-reconnecting (attempt ${attempt})...`);
    const ok = await this.reconnect(accountId, session, account?.proxyUrl);
    if (ok) return finish(); // đã connect → xong

    // Thất bại (reconnect nuốt lỗi, trả false). Hẹn lần thử kế tiếp với backoff.
    if (this.manuallyDisabled.has(accountId)) return finish();
    const backoff = ZaloAccountPool.AUTO_RECONNECT_BACKOFF_MS;
    if (attempt > backoff.length) {
      logger.warn(`[zalo:${accountId}] Auto-reconnect chuỗi này dừng sau ${attempt - 1} lần — health-check (5'/lần) sẽ khởi chuỗi mới.`);
      return finish(); // health-check sẽ ensureReconnecting lại ở tick kế
    }
    const delay = backoff[attempt - 1];
    logger.info(`[zalo:${accountId}] Auto-reconnect attempt ${attempt} thất bại, thử lại sau ${delay / 1000}s`);
    setTimeout(() => this.autoReconnect(accountId, attempt + 1), delay); // cờ vẫn giữ → không chuỗi trùng
  }

  // Stop listener and remove from pool
  disconnect(accountId: string): void {
    this.manuallyDisabled.add(accountId);
    const instance = this.instances.get(accountId);
    if (instance) {
      instance.status = 'disconnected';
    }
    this.instances.delete(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    stopMessageSync(accountId);
  }

  // Disconnect for session refresh (daily cron) — does NOT mark as manually disabled
  disconnectForRefresh(accountId: string): void {
    const instance = this.instances.get(accountId);
    this.instances.delete(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    stopMessageSync(accountId);
  }

  getStatus(accountId: string): string {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  getAllStatuses(): Record<string, string> {
    const statuses: Record<string, string> = {};
    for (const [id, inst] of this.instances) statuses[id] = inst.status;
    return statuses;
  }

  // Return raw API instance for direct SDK calls (e.g. public API send message)
  getApi(accountId: string): any | null {
    const inst = this.instances.get(accountId);
    return inst?.status === 'connected' ? inst.api : null;
  }

  getInstance(accountId: string): ZaloInstance | undefined {
    return this.instances.get(accountId);
  }

  // Link orphaned conversations (contactId is null) to contacts via Zalo API
  private async backfillOrphanedConversations(accountId: string, api: any): Promise<void> {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { orgId: true },
    });
    if (!account) return;

    const orphaned = await prisma.conversation.findMany({
      where: { zaloAccountId: accountId, contactId: null, threadType: 'user' },
      select: { id: true, externalThreadId: true },
    });

    if (orphaned.length === 0) return;
    logger.info(`[zalo:${accountId}] Backfilling ${orphaned.length} orphaned conversation(s)`);

    for (const conv of orphaned) {
      const uid = conv.externalThreadId;
      if (!uid) continue;

      let contact = await prisma.contact.findFirst({
        where: { zaloUid: uid, orgId: account.orgId },
        select: { id: true },
      });

      if (!contact) {
        let zaloName = '';
        let avatar = '';
        let phone = '';
        try {
          const result = await api.getUserInfo(uid);
          const profiles = result?.changed_profiles || {};
          const profile = profiles[uid] || profiles[`${uid}_0`];
          if (profile) {
            zaloName = profile.zaloName || profile.zalo_name || profile.displayName || profile.display_name || '';
            avatar = profile.avatar || '';
            phone = profile.phoneNumber || '';
          }
        } catch (err) {
          logger.warn(`[zalo:${accountId}] getUserInfo failed for ${uid}:`, err);
        }

        const { randomUUID } = await import('node:crypto');
        contact = await prisma.contact.create({
          data: {
            id: randomUUID(),
            orgId: account.orgId,
            zaloUid: uid,
            fullName: zaloName || 'Unknown',
            avatarUrl: avatar || null,
            phone: phone || null,
          },
          select: { id: true },
        });
      }

      await prisma.conversation.update({
        where: { id: conv.id },
        data: { contactId: contact.id },
      });
    }

    logger.info(`[zalo:${accountId}] Backfill complete: ${orphaned.length} conversation(s) linked`);
  }
}

export const zaloPool = new ZaloAccountPool();
