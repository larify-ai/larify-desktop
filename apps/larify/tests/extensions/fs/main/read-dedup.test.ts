import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileTool, readFileWindow } from '../../../../src/extensions/fs/main/read'
import { editFileTool } from '../../../../src/extensions/fs/main/edit'
import { clearReadState } from '../../../../src/extensions/fs/main/state'
import { callTool, freshSession } from './harness'

const read = (
  input: {
    file_path: string
    offset?: number
    column?: number
    limit?: number
    scroll?: 'down' | 'up'
  },
  sessionId: string
): Promise<string> =>
  readFileWindow(
    { column: 1, limit: 50_000, scroll: 'down', ...input },
    { sessionId, cwd: tmpdir() }
  )

const isReceipt = (output: string): boolean =>
  output.startsWith('File unchanged since the last read')

let root: string
let file: string
const content = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join('\n')

/** 把 mtime 往后拨，避免「同一秒内改两次」被秒级精度掩盖。 */
const bumpMtime = (target: string, seconds: number): void => {
  const { atime, mtime } = statSync(target)
  utimesSync(target, atime, new Date(mtime.getTime() + seconds * 1000))
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'larify-read-dedup-'))
  file = path.join(root, 'notes.txt')
  writeFileSync(file, content)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('同一会话、同一文件、同一段文字 ⇒ 只回一句回执', () => {
  it('第二次读不再回正文', async () => {
    const session = freshSession()

    expect(await read({ file_path: file }, session)).toBe(content)

    const again = await read({ file_path: file }, session)

    expect(isReceipt(again)).toBe(true)
    expect(again).not.toContain('line1')
    // 一句话回执：不换行、不带窗口位置，省下的就是上下文
    expect(again).not.toContain('\n')
    expect(again.length).toBeLessThan(120)
  })

  it('原样重读（同一组参数、窗口已到文件末尾）⇒ 回同一句', async () => {
    const session = freshSession()
    const target = path.join(root, 'small.txt')
    const small = 'a\nb\nc'
    writeFileSync(target, small)

    expect(await read({ file_path: target, limit: 5 }, session)).toBe(small)

    expect(isReceipt(await read({ file_path: target, limit: 5 }, session))).toBe(true)
  })

  it('大文件里同一段文字：换 limit ⇒ 窗口不同 ⇒ 照读', async () => {
    const session = freshSession()
    const target = path.join(root, 'paged.txt')
    writeFileSync(target, 'a'.repeat(30_000))

    expect(await read({ file_path: target, limit: 5 }, session)).toContain('Continue from')
    expect(isReceipt(await read({ file_path: target, limit: 9 }, session))).toBe(false)
  })

  it('空文件：第一次回空、第二次回执', async () => {
    const session = freshSession()
    const target = path.join(root, 'empty-dedup.txt')
    writeFileSync(target, '')

    expect(await read({ file_path: target }, session)).toBe('')

    expect(isReceipt(await read({ file_path: target }, session))).toBe(true)
  })
})

describe('真实工具入口（经 zod 解析、limit 已换算成字符）', () => {
  it('同会话连读两次 ⇒ 第二次是一句话回执', async () => {
    const session = freshSession()
    const target = path.join(root, 'entry.ts')
    writeFileSync(target, 'export const a = 1\n')

    expect(
      await callTool<string>(readFileTool, { file_path: target }, { sessionId: session })
    ).toBe('export const a = 1\n')
    expect(
      isReceipt(await callTool<string>(readFileTool, { file_path: target }, { sessionId: session }))
    ).toBe(true)
  })

  it('命中回执之后仍能正常编辑（回执不破坏「先读后改」的登记）', async () => {
    const session = freshSession()
    const target = path.join(root, 'entry-edit.ts')
    writeFileSync(target, 'const v = 1\n')

    await callTool(readFileTool, { file_path: target }, { sessionId: session })
    await callTool(readFileTool, { file_path: target }, { sessionId: session })

    const edit = await callTool<{ summary: string }>(
      editFileTool,
      { file_path: target, old_string: 'const v = 1', new_string: 'const v = 2' },
      { sessionId: session }
    )

    expect(edit.summary).toContain('Edited')
  })
})

describe('上下文被清空（reset context）后，那段文字已不在模型眼前 ⇒ 必须重读', () => {
  it('clearReadState 之后同一段文字不再回执，只清本会话', async () => {
    const session = freshSession()
    const other = freshSession()
    const target = path.join(root, 'after-reset.txt')
    writeFileSync(target, 'payload\n')

    expect(await read({ file_path: target }, session)).toBe('payload\n')
    expect(isReceipt(await read({ file_path: target }, session))).toBe(true)
    await read({ file_path: target }, other)

    clearReadState(session)

    expect(await read({ file_path: target }, session)).toBe('payload\n')
    // 别的会话的已读窗口不受影响
    expect(isReceipt(await read({ file_path: target }, other))).toBe(true)
  })
})

describe('不该去重的情形', () => {
  it('磁盘被改过（mtime 与内容都变）⇒ 重新回正文', async () => {
    const session = freshSession()
    const target = path.join(root, 'changed.txt')
    writeFileSync(target, 'v1')
    await read({ file_path: target }, session)

    writeFileSync(target, 'v2')
    bumpMtime(target, 5)

    expect(await read({ file_path: target }, session)).toBe('v2')
  })

  it('文件后来被追加（原文字不变，文字变长）⇒ 新内容必须能读到', async () => {
    const session = freshSession()
    const target = path.join(root, 'appended.txt')
    writeFileSync(target, 'original')
    await read({ file_path: target }, session)

    writeFileSync(target, 'original\nappended-later')
    bumpMtime(target, 5)

    const again = await read({ file_path: target }, session)

    expect(isReceipt(again)).toBe(false)
    expect(again).toContain('appended-later')
  })

  it('上次没读到文件末尾（被 limit 截断）⇒ 不登记，磁盘没变也照读', async () => {
    const session = freshSession()
    const target = path.join(root, 'truncated.txt')
    writeFileSync(target, 'x'.repeat(30_000))

    expect(await read({ file_path: target, limit: 10_000 }, session)).toContain('Continue from')

    expect(isReceipt(await read({ file_path: target, limit: 10_000 }, session))).toBe(false)
  })

  it('窗口不同（同一文件的另一段）⇒ 各自回正文', async () => {
    const session = freshSession()

    await read({ file_path: file, limit: 10_000 }, session)

    const other = await read({ file_path: file, offset: 20, limit: 10_000 }, session)

    expect(isReceipt(other)).toBe(false)
    expect(other).toContain('line20')
  })

  it('向上滚读到的是另一端 ⇒ 不是重复', async () => {
    const session = freshSession()

    await read({ file_path: file }, session)

    const upward = await read({ file_path: file, scroll: 'up', limit: 5 }, session)

    expect(isReceipt(upward)).toBe(false)
  })

  it('不同会话互不影响（每个会话各自需要看到内容）', async () => {
    const first = freshSession()
    const second = freshSession()

    await read({ file_path: file }, first)

    expect(await read({ file_path: file }, second)).toBe(content)
  })

  it('写文件后不误报未变', async () => {
    const session = freshSession()
    const target = path.join(root, 'after-write.txt')
    writeFileSync(target, 'before')
    await read({ file_path: target }, session)

    writeFileSync(target, 'after')
    bumpMtime(target, 3)

    expect(await read({ file_path: target }, session)).toBe('after')
  })
})
