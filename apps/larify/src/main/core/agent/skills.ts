import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import matter from 'gray-matter'
import { larifyPath, resourcePath } from '../../utils/app-paths'

export interface DiscoveredSkill {
  name: string
  description: string
  path: string
  eager: boolean
}

export function skillRoots(): string[] {
  return [resourcePath('skills'), larifyPath('skills')]
}

function skillFiles(root: string): string[] {
  const files: string[] = []
  const resolvedRoot = resolve(root)
  if (!existsSync(resolvedRoot)) return files

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name === 'SKILL.md') files.push(path)
    }
  }

  visit(resolvedRoot)
  return files.sort()
}

function readSkill(path: string): DiscoveredSkill {
  const source = readFileSync(path, 'utf8')
  if (!matter.test(source)) throw new Error(`Skill at "${path}" must have YAML frontmatter.`)
  const { data } = matter(source)

  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error(`Skill at "${path}" must have a non-empty name.`)
  }
  if (typeof data.description !== 'string' || !data.description.trim()) {
    throw new Error(`Skill "${data.name}" must have a non-empty description.`)
  }
  if (data.eager !== undefined && typeof data.eager !== 'boolean') {
    throw new Error(`Skill "${data.name}" must define eager as a boolean.`)
  }

  return {
    name: data.name.trim(),
    description: data.description.trim(),
    path,
    eager: data.eager === true
  }
}

export function discoverSkills(roots = skillRoots()): DiscoveredSkill[] {
  const skills = new Map<string, DiscoveredSkill>()
  for (const root of roots) {
    for (const path of skillFiles(root)) {
      try {
        const skill = readSkill(path)
        skills.set(skill.name, skill)
      } catch (error) {
        console.warn(
          `[agent skills] Skipped invalid skill "${path}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
  return [...skills.values()]
}
