import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { larifyPath, resourcePath } from "../../../main/utils/app-paths"

export interface Skill {
  name: string
  description: string
  eager: boolean
  path: string
}

export interface SkillFactory {
  eager(): Skill[]
  list(): Skill[]
}

export function skillRoots(): string[] {
  return [resourcePath("skills"), larifyPath("skills")]
}

function findSkillFiles(root: string): string[] {
  const files: string[] = []
  const resolvedRoot = resolve(root)
  if (!existsSync(resolvedRoot)) return files

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name === "SKILL.md") files.push(path)
    }
  }

  visit(resolvedRoot)
  return files.sort()
}

function readSkill(path: string): Skill {
  const source = readFileSync(path, "utf8")
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`Skill at "${path}" must have YAML frontmatter.`)

  const data: Record<string, unknown> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    let value: unknown = line.slice(separator + 1).trim()
    if (
      typeof value === "string" &&
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    } else if (value === "true") {
      value = true
    } else if (value === "false") {
      value = false
    }
    data[key] = value
  }

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new Error(`Skill at "${path}" must have a non-empty name.`)
  }
  if (typeof data.description !== "string" || !data.description.trim()) {
    throw new Error(`Skill "${data.name}" must have a non-empty description.`)
  }
  if (data.eager !== undefined && typeof data.eager !== "boolean") {
    throw new Error(`Skill "${data.name}" must define eager as a boolean.`)
  }

  return {
    name: data.name.trim(),
    description: data.description.trim(),
    eager: data.eager === true,
    path,
  }
}

export function createSkillFactory(roots: string[]): SkillFactory {
  const skills = new Map<string, Skill>()

  for (const root of roots) {
    for (const path of findSkillFiles(root)) {
      const skill = readSkill(path)
      skills.set(skill.name, skill)
    }
  }

  const eager = (): Skill[] => [...skills.values()].filter((skill) => skill.eager)

  const list = (): Skill[] => [...skills.values()].filter((skill) => !skill.eager)

  return { eager, list }
}
