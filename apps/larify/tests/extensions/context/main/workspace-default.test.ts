import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ indexes: '' }))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  ensureLarifyPath: () => mock.indexes
}))

import {
  cleanContextRegistry,
  registerContext,
  workspaceIndexPath
} from '../../../../src/extensions/context/main/workspace'

let root: string

afterEach(() => rmSync(root, { recursive: true, force: true }))

it('uses the default indexes directory', () => {
  root = mkdtempSync(join(tmpdir(), 'larify-default-indexes-'))
  mock.indexes = join(root, 'indexes')
  const workspace = join(root, 'workspace')

  expect(workspaceIndexPath(workspace).startsWith(mock.indexes)).toBe(true)
  registerContext(workspace)
  cleanContextRegistry()

  const registry = JSON.parse(readFileSync(join(mock.indexes, 'registry.json'), 'utf8'))
  expect(registry.contexts).toEqual([])
})
