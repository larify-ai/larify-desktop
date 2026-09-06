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
    // 排除调试/探针残留：`_tmp-*` 是排障时的临时测试，不应作为正式测试被收集运
    // 行（否则会污染全量测试结果，如 _tmp 用例失败）。其余沿 vitest 默认 exclude。
    exclude: [
      "**/_tmp-*.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*"
    ],
    environment: "node",
    // React 只在其 development 构建导出 `act`（prod 构建不导出）。测试若运行在
    // NODE_ENV=production 下会加载 prod 版 react，导致所有 `import { act } from
    // 'react'` 报 `act is not a function`。测试本应使用 development 构建，故显式
    // 固定为 development。
    env: { NODE_ENV: "development" },
  },
})
