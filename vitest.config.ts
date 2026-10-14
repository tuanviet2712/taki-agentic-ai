import { defineConfig } from "vitest/config";

// Only this system's tests — services/zl-crm has its own test suite.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "evals/**/*.test.ts"], exclude: ["**/node_modules/**", "services/**"],
    // Test KHÔNG được chạm Chrome Flow thật của máy (cổng 9333): closeFlowBrowser() gửi lệnh đóng tới cổng này, từng làm tắt Chrome Flow
    // đang chạy video của Sếp mỗi khi chạy `pnpm test`. Cổng giả không có ai lắng nghe → test không đụng được vào Chrome thật.
    env: { FLOW_CDP_PORT: "59333" },
  },
});
