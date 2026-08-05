import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSkills } from '../../../../src/main/core/agent/skills'

const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function writeSkill(directory: string, frontmatter: string): string {
  const path = join(root, directory, 'SKILL.md')
  mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(path, `---\n${frontmatter}\n---\n`)
  return path
}

describe('discoverSkills', () => {
  it('reads valid skills and skips invalid ones', () => {
    const path = writeSkill('valid', 'name: valid\ndescription: Valid skill\neager: true')
    writeSkill('invalid', 'name: invalid')

    expect(discoverSkills([root])).toEqual([
      { name: 'valid', description: 'Valid skill', path, eager: true }
    ])
  })
})
