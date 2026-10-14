/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from './zalo-pool.js';

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    // Client should send orgId after connecting to join org-level room
    socket.on('org:join', (data: { orgId: string }) => {
      if (!data?.orgId) return;
      socket.join(`org:${data.orgId}`);
      logger.debug(`Socket ${socket.id} joined org:${data.orgId}`);
    });

    // Subscribe to QR/status updates for a specific Zalo account
    socket.on('zalo:subscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      socket.join(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
    });

    // Unsubscribe from a specific account room
    socket.on('zalo:unsubscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      const room = `account:${data.accountId}`;
      socket.leave(room);
      logger.debug(`Socket ${socket.id} left ${room}`);
      // Không còn ai xem QR của nick này (đóng hộp thoại) → huỷ phiên chờ quét để nhả khoá đăng nhập.
      if (!(io.sockets.adapter.rooms.get(room)?.size)) zaloPool.cancelQR(data.accountId);
    });

    // Đóng tab / mất mạng khi đang mở hộp thoại QR cũng phải nhả phiên chờ quét.
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (!room.startsWith('account:')) continue;
        if ((io.sockets.adapter.rooms.get(room)?.size ?? 0) <= 1) zaloPool.cancelQR(room.slice('account:'.length));
      }
    });
  });
}
