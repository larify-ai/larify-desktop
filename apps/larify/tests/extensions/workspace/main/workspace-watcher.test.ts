import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chokidar = vi.hoisted(() => {
  const watchers: Array<{
    add: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    emit(event: string, path: string): void
    on: ReturnType<typeof vi.fn>
  }> = []
  return {
    watchers,
    watch: vi.fn(() => {
      let listener: ((event: string, path: string) => void) | undefined
      const watcher = {
        add: vi.fn(),
        close: vi.fn(async () => undefined),
        emit: (event: string, path: string): void => listener?.(event, path),
        on: vi.fn((_name: string, next: typeof listener) => {
          listener = next
        })
      }
      watchers.push(watcher)
      return watcher
    })
  }
})

vi.mock('chokidar', () => ({ watch: chokidar.watch }))

import { WorkspaceService } from '../../../../src/extensions/workspace/main/service'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-workspace-watcher-'))
  roots.push(root)
  return root
}

beforeEach(() => {
  chokidar.watchers.length = 0
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WorkspaceService watcher', () => {
  it('watches the root and directories as they are listed', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    await service.list(child)

    expect(chokidar.watch).toHaveBeenCalledWith(root, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    expect(chokidar.watchers[0].add).toHaveBeenCalledOnce()
    expect(chokidar.watchers[0].add).toHaveBeenCalledWith(child)
    await service.dispose()
  })

  it('forwards changes and closes its watcher when disposed', async () => {
    const root = await createRoot()
    const onChange = vi.fn()
    const service = new WorkspaceService(root, onChange)

    await service.rootPath()
    chokidar.watchers[0].emit('change', path.join(root, 'file.ts'))
    await service.dispose()

    expect(onChange).toHaveBeenCalledWith('change', path.join(root, 'file.ts'))
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('can be disposed immediately after construction', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined)

    await service.dispose()

    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })
})
