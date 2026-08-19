import { z } from 'zod'
import { defineTool, type Tool, type ToolRunContext } from '../../../main/core/plugin/protocol'
import type { BrowserService } from './browser-service'
import { waitForOperationOrAbort } from './waits'

export interface WebSearchResult {
  title: string
  url: string
  snippet?: string
}

export interface WebSearchResponse {
  results: WebSearchResult[]
  nextPageUrl?: string
}

const selectorSchema = z.string().trim().min(1)

const selectorsSchema = z
  .object({
    result: selectorSchema.default('#b_results > li.b_algo'),
    title: selectorSchema.default('h2'),
    link: selectorSchema.default('h2 a[href], a[href]:has(> h2)'),
    snippet: selectorSchema.default('.b_caption p, p.b_algoSlug, p.b_lineclamp2, p.b_lineclamp3'),
    nextPage: selectorSchema.default('a.sb_pagN[href]')
  })
  .strict()
  .prefault({})

export type WebSearchSelectors = z.infer<typeof selectorsSchema>

export const webSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).optional().describe('Search query for a new web search'),
    pageUrl: z.string().trim().min(1).optional().describe('Search page URL or next-page URL'),
    selectors: selectorsSchema.describe('CSS selectors used to extract the search results')
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.query) === Boolean(value.pageUrl)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of query or pageUrl'
      })
    }
  })

export function normalizeWhitespace(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

export function buildBingSearchUrl(query: string): string {
  const url = new URL('https://www.bing.com/search')
  url.searchParams.set('q', query)
  return url.toString()
}

export function parseSearchResult(
  item: HTMLElement,
  selectors: WebSearchSelectors
): WebSearchResult | undefined {
  const text = (selector: string): string =>
    normalizeWhitespace(item.querySelector(selector)?.textContent)
  const title = text(selectors.title)
  const url = item.querySelector<HTMLAnchorElement>(selectors.link)?.href
  if (!title || !url) return

  const snippet = text(selectors.snippet)
  return { title, url, ...(snippet && { snippet }) }
}

export function parseSearchPage(selectors: WebSearchSelectors): WebSearchResponse {
  const seenUrls = new Set<string>()
  const results = Array.from(document.querySelectorAll<HTMLElement>(selectors.result)).flatMap(
    (item) => {
      const result = parseSearchResult(item, selectors)
      if (!result || seenUrls.has(result.url)) return []
      seenUrls.add(result.url)
      return [result]
    }
  )
  const nextPageUrl =
    document.querySelector<HTMLAnchorElement>(selectors.nextPage)?.href || undefined

  return { results, ...(nextPageUrl && { nextPageUrl }) }
}

export function buildParseSearchPageScript(selectors: WebSearchSelectors): string {
  // IMPORTANT: This script is injected into the search page and MUST stay self-contained.
  // Never reference module-level identifiers or use `Function.prototype.toString` here:
  // minifiers rename those identifiers, and the serialized script would then throw
  // e.g. `ReferenceError: Fn is not defined` in compressed builds.
  return `(() => {
    const normalizeWhitespace = (value) => {
      return (value == null ? '' : String(value)).replace(/\\s+/g, ' ').trim()
    }
    const parseSearchResult = (item, selectors) => {
      const text = (selector) => normalizeWhitespace(item.querySelector(selector)?.textContent)
      const title = text(selectors.title)
      const url = item.querySelector(selectors.link)?.href
      if (!title || !url) return undefined
      const snippet = text(selectors.snippet)
      return { title, url, ...(snippet ? { snippet } : {}) }
    }
    const parseSearchPage = (selectors) => {
      const seenUrls = new Set()
      const results = Array.from(document.querySelectorAll(selectors.result)).flatMap((item) => {
        const result = parseSearchResult(item, selectors)
        if (!result || seenUrls.has(result.url)) return []
        seenUrls.add(result.url)
        return [result]
      })
      const nextPageUrl = document.querySelector(selectors.nextPage)?.href || undefined
      return { results, ...(nextPageUrl ? { nextPageUrl } : {}) }
    }
    return parseSearchPage(${JSON.stringify(selectors)})
  })()`
}

export async function executeWebSearch(
  service: BrowserService,
  input: z.infer<typeof webSearchInputSchema>,
  ctx: ToolRunContext
): Promise<WebSearchResponse> {
  if (ctx.signal?.aborted) throw new Error('Web search was cancelled.')
  const url = input.pageUrl ?? buildBingSearchUrl(input.query!)

  return service.withTemporaryTab(ctx.sessionId, url, async (tab) => {
    await waitForOperationOrAbort(tab.waitForNavigation(), ctx.signal, 'Web search was cancelled.')

    const parsed = (await waitForOperationOrAbort(
      tab.evalJs(buildParseSearchPageScript(input.selectors)),
      ctx.signal,
      'Web search was cancelled.'
    )) as WebSearchResponse | undefined

    if (!parsed || parsed.results.length === 0) {
      throw new Error('The page returned no parseable search results.')
    }

    return {
      results: parsed.results,
      ...(parsed.nextPageUrl && { nextPageUrl: parsed.nextPageUrl })
    }
  })
}

export function webSearchTools(service: BrowserService): Record<string, Tool> {
  return {
    web_search: defineTool({
      description:
        'Search the web. Returns titles, URLs, snippets, and an optional nextPageUrl. Pass nextPageUrl as pageUrl to continue; use web_fetch to read a result.',
      metadata: { icon: 'browser', eager: true },
      inputSchema: webSearchInputSchema,
      execute: (args, ctx) => executeWebSearch(service, args, ctx)
    })
  }
}
