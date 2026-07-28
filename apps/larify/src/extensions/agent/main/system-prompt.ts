import { Liquid } from "liquidjs"
import template from "./prompt.md?raw"
import type { ToolRegistry } from "./registry"
import type { SkillFactory } from "./skill-factory"

const liquid = new Liquid()

function platformName(): string {
  if (process.platform === "win32") return "Windows"
  if (process.platform === "darwin") return "macOS"
  if (process.platform === "linux") return "Linux"
  return process.platform
}

export function buildSystemPrompt(
  registry: ToolRegistry,
  cwd: string,
  skillFactory?: SkillFactory,
): string {
  const toolkits = registry.listToolkits()
  const skills = skillFactory
    ?.eager()
    .map(({ name, description, path }) => ({ name, description, path }))
  return liquid.parseAndRenderSync(template, {
    toolkits,
    skills,
    platform: platformName(),
    cwd,
  }).trim()
}
