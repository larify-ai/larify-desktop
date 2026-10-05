// 守门：**任何读取文件的入口都必须登记「该文件所在目录」**。
//
// 背景（真因）：工作台「变更」视图取文件内容走的是 `readFile`，而它过去**从不登记**——
// 只监听目录变化去刷 git 状态。于是「只在变更视图里打开过的深层文件」没有 watcher，
// `depth:0` 下 root 的 watcher 又看不见 `root/sub/file` ⇒ 写入不产生事件 ⇒ 内容停在旧版。
//
// 因此断言：readFile / readAsset / inspectFile 三者都登记 `dirname(file)`。

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recorded = vi.hoisted(() => ({ watchRoots: [] as string[] }))

vi.mock('chokidar', () => {
  interface FakeWatcher {
    close(): Promise<void>
    on(event: string, handler: (...args: unknown[]) => void): FakeWatcher
    once(event: string, handler: (...args: unknown[]) => void): FakeWatcher
    off(event: string, handler: (...args: unknown[]) => void): FakeWatcher
  }
  return {
    watch: (directory: string): FakeWatcher => {
      recorded.watchRoots.push(directory)
      const watcher: FakeWatcher = {
        close: async () => undefined,
        on: () => watcher,
        once: (event, handler) => {
          if (event === 'ready') handler()
          return watcher
        },
        off: () => watcher
      }
      return watcher
    }
  }
})

import { WorkspaceService } from '../../../../src/extensions/workspace/main/service'

describe('读取文件时登记其所在目录', () => {
  let root: string

  beforeEach(async () => {
    recorded.watchRoots = []
    root = await mkdtemp(path.join(tmpdir(), 'ws-register-'))
    await mkdir(path.join(root, 'sub'), { recursive: true })
    await writeFile(path.join(root, 'sub', 'doc.md'), '# doc\n')
    await writeFile(path.join(root, 'sub', 'pic.png'), 'not-really-png')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('readFile 必须登记父目录（变更视图取内容走的就是这条）', async () => {
    const service = new WorkspaceService(root, () => undefined)
    const resolved = await service.rootPath()

    await service.readFile(path.join(resolved, 'sub', 'doc.md'))

    expect(recorded.watchRoots).toContain(path.join(resolved, 'sub'))
    await service.dispose()
  })

  it('readAsset 必须登记父目录', async () => {
    const service = new WorkspaceService(root, () => undefined)
    const resolved = await service.rootPath()

    await service.readAsset(path.join(resolved, 'sub', 'pic.png'))

    expect(recorded.watchRoots).toContain(path.join(resolved, 'sub'))
    await service.dispose()
  })

  it('inspectFile 必须登记父目录', async () => {
    const service = new WorkspaceService(root, () => undefined)
    const resolved = await service.rootPath()

    await service.inspectFile(path.join(resolved, 'sub', 'doc.md'))

    expect(recorded.watchRoots).toContain(path.join(resolved, 'sub'))
    await service.dispose()
  })

  it('root 之外的文件不登记', async () => {
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    const outside = await mkdtemp(path.join(tmpdir(), 'ws-reg-out-'))
    await writeFile(path.join(outside, 'x.md'), '# x\n')

    await service.readFile(path.join(outside, 'x.md'))

    expect(recorded.watchRoots.every((e) => !e.startsWith(outside))).toBe(true)
    await service.dispose()
    await rm(outside, { recursive: true, force: true })
  })
})
