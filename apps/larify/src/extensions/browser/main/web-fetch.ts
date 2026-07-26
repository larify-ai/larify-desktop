import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { prepareToolOutput } from '../../../main/utils/tool-output'
import { defineTool, type Toolkit, type ToolRunContext } from '../../../shared/tool'
import type { BrowserService } from './browser-service'
import type { BrowserTab } from './tab'
import { normalizeUrl } from './url'
import { waitForOperationOrAbort } from './waits'

export const webFetchInputSchema = z
  .object({
    url: z.string().trim().min(1).describe('URL or local file path to read')
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
    await waitForOperationOrAbort(tab.waitForNavigation(), ctx.signal, 'Web fetch was cancelled.')
    const page = await waitForOperationOrAbort(tab.read(), ctx.signal, 'Web fetch was cancelled.')
    return pageContentOutput(page)
  })
}

export function webFetchTools(getService: () => BrowserService): Toolkit['tools'] {
  return {
    web_fetch: defineTool({
      description:
        'Read a URL or local file in a temporary browser tab and return its title and clean Markdown content.',
      metadata: { icon: 'browser', eager: true },
      inputSchema: webFetchInputSchema,
      execute: (args, ctx) => executeWebFetch(getService(), args, ctx)
    })
  }
}
