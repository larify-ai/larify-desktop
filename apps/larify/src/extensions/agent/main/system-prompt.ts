import { Liquid } from "liquidjs"
import template from "./prompt.md?raw"
import type { ToolRegistry } from "./registry"

const liquid = new Liquid()

export function buildSystemPrompt(registry: ToolRegistry): string {
  return liquid.parseAndRenderSync(template, { kits: registry.listKits() }).trim()
}
