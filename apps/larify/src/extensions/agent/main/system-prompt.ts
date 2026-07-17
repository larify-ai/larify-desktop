import { Liquid } from "liquidjs"
import template from "./prompt.md?raw"
import type { ToolRegistry } from "./registry"

const liquid = new Liquid()

function platformName(): string {
  if (process.platform === "win32") return "Windows"
  if (process.platform === "darwin") return "macOS"
  if (process.platform === "linux") return "Linux"
  return process.platform
}

export function buildSystemPrompt(registry: ToolRegistry): string {
  return liquid.parseAndRenderSync(template, {
    kits: registry.listKits(),
    platform: platformName(),
  }).trim()
}
