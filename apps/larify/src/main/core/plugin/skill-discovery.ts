import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import parseFrontMatter from 'front-matter'
import { larifyPath, resourcePath } from '../../utils/app-paths'
import type { Skill } from './protocol'

export type DiscoveredSkill = Skill & { name: string }

export interface SkillDiscovery {
  discover(pluginId: string): DiscoveredSkill[]
}

function findSkillFiles(root: string): string[] {
  const resolvedRoot = resolve(root)
  if (!existsSync(resolvedRoot)) return []

  const files: string[] = []
  const visit = (directory: string): void => {
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
  if (!parseFrontMatter.test(source)) {
    throw new Error(`Skill at "${path}" must have YAML frontmatter.`)
  }
  const data = parseFrontMatter<Record<string, unknown>>(source).attributes

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
    path,
    description: data.description.trim(),
    ...(data.eager === true && { metadata: { eager: true } })
  }
}

export class FilesystemSkillDiscovery implements SkillDiscovery {
  constructor(
    private readonly rootsFor = (pluginId: string): string[] => [
      resourcePath('plugins', pluginId, 'skills'),
      larifyPath('plugins', pluginId, 'skills')
    ]
  ) {}

  discover(pluginId: string): DiscoveredSkill[] {
    const skills = new Map<string, DiscoveredSkill>()
    for (const root of this.rootsFor(pluginId)) {
      let paths: string[]
      try {
        paths = findSkillFiles(root)
      } catch (error) {
        console.warn(`[plugin] Skipped unreadable skill directory "${root}":`, error)
        continue
      }
      for (const path of paths) {
        try {
          const skill = readSkill(path)
          skills.set(skill.name, skill)
        } catch (error) {
          console.warn(`[plugin] Skipped invalid skill "${path}":`, error)
        }
      }
    }
    return [...skills.values()]
  }
}
