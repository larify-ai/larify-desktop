import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import matter from "gray-matter"
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
  if (!matter.test(source)) throw new Error(`Skill at "${path}" must have YAML frontmatter.`)
  const { data } = matter(source)

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
      try {
        const skill = readSkill(path)
        skills.set(skill.name, skill)
      } catch (error) {
        console.warn(
          `[agent skills] Skipped invalid skill "${path}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  const eager = (): Skill[] => [...skills.values()].filter((skill) => skill.eager)

  const list = (): Skill[] => [...skills.values()]

  return { eager, list }
}
