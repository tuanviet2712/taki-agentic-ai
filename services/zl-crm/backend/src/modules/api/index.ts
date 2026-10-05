/**
 * Public API plugin — gom public-api + webhook-settings (Phase 4 batch 2 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { publicApiRoutes } from './public-api-routes.js';
import { webhookSettingsRoutes } from './webhook-settings-routes.js';
import { groupPostLogRoutes } from './group-post-log-routes.js';
import { chaoHangPublicRoutes } from './chao-hang-public-routes.js';
import { chaoHangRoutes } from './chao-hang-routes.js';
import { publicFriendRoutes } from './public-friend-routes.js';

export const apiPlugin: ZaloCrmPlugin = {
  name: 'api',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(publicApiRoutes);
    await app.register(webhookSettingsRoutes);
    await app.register(groupPostLogRoutes);
    await app.register(chaoHangPublicRoutes);
    await app.register(chaoHangRoutes);
    await app.register(publicFriendRoutes); // kết bạn Zalo theo SĐT cho hệ thống ngoài (Agentic AI — Chăm khách từ bình luận)
  },
};
