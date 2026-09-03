import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@renderer": resolve("src/renderer/src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // React 只在其 development 构建导出 `act`（prod 构建不导出）。测试若运行在
    // NODE_ENV=production 下会加载 prod 版 react，导致所有 `import { act } from
    // 'react'` 报 `act is not a function`。测试本应使用 development 构建，故显式
    // 固定为 development。
    env: { NODE_ENV: "development" },
  },
})
