import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  executeWebFetch,
  pageContentOutput,
  webFetchInputSchema
} from '../../../../src/extensions/browser/main/web-fetch'
import type { BrowserService } from '../../../../src/extensions/browser/main/browser-service'
import type { BrowserTab } from '../../../../src/extensions/browser/main/tab'

describe('web fetch', () => {
  it('validates a URL or local file path', () => {
    expect(webFetchInputSchema.parse({ url: 'https://example.com' })).toEqual({
      url: 'https://example.com'
    })
    expect(webFetchInputSchema.parse({ url: 'D:\\docs\\page.html' })).toEqual({
      url: 'D:\\docs\\page.html'
    })
    expect(webFetchInputSchema.safeParse({ url: '' }).success).toBe(false)
  })

  it('reads a page in a temporary tab', async () => {
    const tab = {
      waitForNavigation: vi.fn(async () => undefined),
      read: vi.fn(async () => ({
        url: 'https://example.com/final',
        title: 'Example',
        content: '# Example'
      }))
    }
    const service = {
      withTemporaryTab: vi.fn(
        async (
          _sessionId: string,
          _url: string,
          callback: (temporaryTab: BrowserTab) => Promise<unknown>
        ) => callback(tab as unknown as BrowserTab)
      )
    } as unknown as BrowserService

    await expect(
      executeWebFetch(
        service,
        { url: 'https://example.com' },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).resolves.toEqual({
      url: 'https://example.com/final',
      title: 'Example',
      content: '# Example'
    })
    expect(service.withTemporaryTab).toHaveBeenCalledWith(
      'session-1',
      'https://example.com',
      expect.any(Function)
    )
  })

  it('rejects invalid URLs and missing file paths before creating a temporary tab', async () => {
    const service = {
      withTemporaryTab: vi.fn()
    } as unknown as BrowserService

    await expect(
      executeWebFetch(
        service,
        { url: 'not a URL or file' },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).rejects.toThrow('Invalid URL or file path')
    await expect(
      executeWebFetch(
        service,
        { url: 'D:\\definitely-missing\\page.html' },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).rejects.toThrow('Invalid URL or file path')
    expect(service.withTemporaryTab).not.toHaveBeenCalled()
  })

  it('resolves an existing relative file path against the tool cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'larify-web-fetch-'))
    const relativePath = 'page.html'
    const absolutePath = join(cwd, relativePath)
    writeFileSync(absolutePath, '<h1>Local</h1>')
    const service = {
      withTemporaryTab: vi.fn(
        async (
          _sessionId: string,
          _url: string,
          callback: (temporaryTab: BrowserTab) => Promise<unknown>
        ) =>
          callback({
            waitForNavigation: vi.fn(async () => undefined),
            read: vi.fn(async () => ({
              url: pathToFileURL(absolutePath).href,
              title: 'Local',
              content: '# Local'
            }))
          } as unknown as BrowserTab)
      )
    } as unknown as BrowserService

    try {
      await expect(
        executeWebFetch(
          service,
          { url: relativePath },
          { sessionId: 'session-1', cwd }
        )
      ).resolves.toMatchObject({
        url: pathToFileURL(absolutePath).href,
        title: 'Local',
        content: '# Local'
      })
      expect(service.withTemporaryTab).toHaveBeenCalledWith(
        'session-1',
        pathToFileURL(absolutePath).href,
        expect.any(Function)
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('preserves page metadata when content spills to disk', () => {
    const content = 'x'.repeat(31_000)
    const output = pageContentOutput({
      url: 'https://example.com',
      title: 'Example',
      content
    }) as { url: string; title: string; path: string; bytes: number; preview: string }

    expect(output).toMatchObject({
      url: 'https://example.com',
      title: 'Example',
      bytes: Buffer.byteLength(content),
      preview: content.slice(0, 1500)
    })
    expect(existsSync(output.path)).toBe(true)
    expect(readFileSync(output.path, 'utf8')).toBe(content)
  })

  it('cancels a pending fetch', async () => {
    const controller = new AbortController()
    const service = {
      withTemporaryTab: vi.fn(
        async (
          _sessionId: string,
          _url: string,
          callback: (temporaryTab: BrowserTab) => Promise<unknown>
        ) =>
          callback({
            waitForNavigation: vi.fn(() => new Promise<void>(() => {}))
          } as unknown as BrowserTab)
      )
    } as unknown as BrowserService

    const pending = executeWebFetch(
      service,
      { url: 'https://example.com' },
      { sessionId: 'session-1', cwd: 'D:\\Workspace', signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toThrow('Web fetch was cancelled.')
  })
})
