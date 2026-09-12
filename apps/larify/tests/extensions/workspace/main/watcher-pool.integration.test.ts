import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceService } from '../../../../src/extensions/workspace/main/service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('Workspace watcher integration', () => {
  it('isolates, unwatches, and resumes real nested directory watches', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'larify-watcher-pool-integration-'))
    roots.push(root)
    const child = path.join(root, 'child')
    await mkdir(child)
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const first = new WorkspaceService(root, firstChange)
    const second = new WorkspaceService(root, secondChange)
    await Promise.all([first.list(child), second.list(root)])

    const firstFile = path.join(child, 'first.txt')
    await writeFile(firstFile, 'first')
    await vi.waitFor(() => expect(firstChange).toHaveBeenCalledWith(child, firstFile))
    expect(secondChange).not.toHaveBeenCalledWith(child, firstFile)

    await first.dispose()
    secondChange.mockClear()
    const unwatchedFile = path.join(child, 'unwatched.txt')
    await writeFile(unwatchedFile, 'unwatched')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(secondChange).not.toHaveBeenCalledWith(child, unwatchedFile)

    await second.list(child)
    const resumedFile = path.join(child, 'resumed.txt')
    await writeFile(resumedFile, 'resumed')
    await vi.waitFor(() => expect(secondChange).toHaveBeenCalledWith(child, resumedFile))

    await second.dispose()
  })

  it('forwards real changes for a file whose directory was never listed, once opened', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'larify-watcher-pool-integration-'))
    roots.push(root)
    const nested = path.join(root, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    const file = path.join(nested, 'watched.txt')
    await writeFile(file, 'one')

    const onChange = vi.fn()
    const service = new WorkspaceService(root, onChange)
    // 只 list 根目录：nested 从未被展开（修复前的盲区）。
    await service.list(root)

    // 先打开（inspect）该文件——修复后应补齐其父目录监听。
    await service.inspectFile(file)

    // 确保父目录 watcher 已 ready。
    await new Promise((resolve) => setTimeout(resolve, 300))
    await writeFile(file, 'two')

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(nested, file))
    await service.dispose()
  })
})
