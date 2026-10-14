import type { FastifyInstance } from "fastify";
import { chatRoutes } from "./routes/chat.ts";
import { coreRoutes } from "./routes/core.ts";
import { growthRoutes } from "./routes/growth.ts";
import { jevRoutes } from "./routes/jev.ts";
import { workRoutes } from "./routes/work.ts";
import { skillRoutes } from "./routes/skills.ts";
import { creativeRoutes } from "./routes/creative.ts";
import { connectRoutes } from "./routes/connect.ts";
import { zaloRoutes } from "./routes/zalo.ts";
import { orchestraRoutes } from "./routes/orchestra.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { accountRoutes } from "./routes/account.ts";
import { channelRoutes } from "./routes/channels.ts";
import { messengerRoutes } from "./routes/messenger.ts";
import { nurtureRoutes } from "./routes/nurture.ts";
import { researchRoutes } from "./routes/research.ts";
import { autopilotRoutes } from "./routes/autopilot.ts";
import { orderRoutes } from "./routes/orders.ts";
import { commentLinkRoutes } from "./routes/comment-link.ts";
import { businessRoutes } from "./routes/businesses.ts";
import { brainRoutes } from "./routes/brain.ts";

/**
 * Danh sách module route của API, đúng thứ tự khởi động thật. server.ts và server-boot.test.ts cùng dùng hàm này nên
 * một route mới (hoặc trình phân tích content-type bị đăng ký trùng…) làm hỏng việc khởi động sẽ lộ ra trong `pnpm test`.
 * Thêm module route mới ở ĐÂY.
 */
export function registerApiRoutes(app: FastifyInstance) {
  coreRoutes(app);
  workRoutes(app);
  growthRoutes(app);
  chatRoutes(app);
  jevRoutes(app);
  skillRoutes(app);
  creativeRoutes(app);
  connectRoutes(app);
  zaloRoutes(app);
  orchestraRoutes(app);
  assistantRoutes(app);
  brainRoutes(app);
  accountRoutes(app);
  channelRoutes(app);
  messengerRoutes(app);
  nurtureRoutes(app);
  researchRoutes(app);
  autopilotRoutes(app);
  orderRoutes(app);
  commentLinkRoutes(app);
  businessRoutes(app);
}
