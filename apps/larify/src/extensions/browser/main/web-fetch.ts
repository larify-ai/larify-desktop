import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { prepareToolOutput, type ToolPayload } from '../../../main/utils/tool-output'
import { defineTool, type Tool, type ToolRunContext } from '../../../main/core/plugin/protocol'
import type { BrowserService } from './browser-service'
import type { BrowserTab } from './tab'
import { normalizeUrl } from './url'
import { waitForOperationOrAbort } from './waits'

const TRANSIENT_NAVIGATION_ERROR =
  /ERR_(?:SOCKET_NOT_CONNECTED|NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|TIMED_OUT)/

export const webFetchInputSchema = z
  .object({
    url: z.string().trim().min(1).describe('URL to read')
  })
  .strict()

export function pageContentOutput(
  page: Awaited<ReturnType<BrowserTab['read']>>,
  includeUrl = true
): Record<string, unknown> {
  const metadata = { ...(includeUrl && { url: page.url }), title: page.title }
  const output = prepareToolOutput(page.content)
  if ('inline' in output) return { ...metadata, content: output.inline }
  return {
    ...metadata,
    path: output.path,
    bytes: output.bytes,
    preview: output.preview
  }
}

function textContentOutput(url: string, output: ToolPayload): Record<string, unknown> {
  return 'inline' in output ? { url, content: output.inline } : { url, ...output }
}

export async function executeWebFetch(
  service: BrowserService,
  input: z.infer<typeof webFetchInputSchema>,
  ctx: ToolRunContext
): Promise<Record<string, unknown>> {
  if (ctx.signal?.aborted) throw new Error('Web fetch was cancelled.')
  const relativePath = resolve(ctx.cwd, input.url)
  const url = existsSync(relativePath) ? normalizeUrl(relativePath) : normalizeUrl(input.url)
  if (!url) throw new Error(`Invalid URL or file path: ${input.url}`)

  return service.withTemporaryTab(ctx.sessionId, url, async (tab) => {
    let navigationError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await waitForOperationOrAbort(
          tab.waitForNavigation(),
          ctx.signal,
          'Web fetch was cancelled.'
        )
        navigationError = undefined
        break
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('navigation load event timed out after')
        ) {
          navigationError = error
          break
        }
        if (
          attempt === 0 &&
          error instanceof Error &&
          TRANSIENT_NAVIGATION_ERROR.test(error.message) &&
          tab.navigate(url)
        ) {
          continue
        }
        throw error
      }
    }
    let page: Awaited<ReturnType<BrowserTab['read']>>
    try {
      page = await waitForOperationOrAbort(tab.read(), ctx.signal, 'Web fetch was cancelled.')
    } catch (error) {
      const output = await service.readText(url, ctx.signal).catch(() => undefined)
      if (!output) throw error
      return textContentOutput(url, output)
    }
    if (navigationError && (!page.url || page.url === 'about:blank' || !page.content.trim())) {
      throw navigationError
    }
    return pageContentOutput(page)
  })
}

export function webFetchTools(service: BrowserService): Record<string, Tool> {
  return {
    web_fetch: defineTool({
      description:
        'Read a URL returned by web_search in a temporary browser tab and return its title and clean Markdown content.',
      metadata: { icon: 'browser', eager: true },
      inputSchema: webFetchInputSchema,
      execute: (args, ctx) => executeWebFetch(service, args, ctx)
    })
  }
}
