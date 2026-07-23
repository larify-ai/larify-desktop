import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { app } = vi.hoisted(() => ({ app: { isPackaged: false } }))
vi.mock("electron", () => ({ app }))

import { resourcePath } from "../../../src/main/utils/app-paths"

describe("resourcePath", () => {
  const original = process.resourcesPath

  afterEach(() => {
    app.isPackaged = false
    ;(process as { resourcesPath?: string }).resourcesPath = original
  })

  it("resolves against ./resources in development", () => {
    app.isPackaged = false

    expect(resourcePath("shell-integration", "shellIntegration.ps1")).toBe(
      join(process.cwd(), "resources", "shell-integration", "shellIntegration.ps1"),
    )
  })

  it("resolves into app.asar.unpacked/resources when packaged", () => {
    app.isPackaged = true
    ;(process as { resourcesPath?: string }).resourcesPath = join("/opt", "larify", "resources")

    expect(resourcePath("shell-integration", "shellIntegration.ps1")).toBe(
      join("/opt", "larify", "resources", "app.asar.unpacked", "resources", "shell-integration", "shellIntegration.ps1"),
    )
  })
})
