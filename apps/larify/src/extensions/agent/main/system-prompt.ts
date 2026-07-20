import { Liquid } from "liquidjs"
import template from "./prompt.md?raw"
import type { ToolRegistry } from "./registry"
import { larifyWorkspacePath } from "../../../main/utils/app-paths"

const liquid = new Liquid()

function platformName(): string {
  if (process.platform === "win32") return "Windows"
  if (process.platform === "darwin") return "macOS"
  if (process.platform === "linux") return "Linux"
  return process.platform
}

export function buildSystemPrompt(registry: ToolRegistry, cwd = larifyWorkspacePath()): string {
  const toolkits = registry.listToolkits()
  return liquid.parseAndRenderSync(template, {
    toolkits,
    toolkitsJson: JSON.stringify({ toolkits }, null, 2),
    platform: platformName(),
    cwd,
  }).trim()
}
