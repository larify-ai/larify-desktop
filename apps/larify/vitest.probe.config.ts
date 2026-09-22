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
    include: ["probes/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "development" },
  },
})
