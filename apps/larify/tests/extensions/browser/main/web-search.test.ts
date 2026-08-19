import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  buildBingSearchUrl,
  buildParseSearchPageScript,
  executeWebSearch,
  normalizeWhitespace,
  parseSearchPage,
  parseSearchResult,
  webSearchInputSchema
} from '../../../../src/extensions/browser/main/web-search'
import type { BrowserService } from '../../../../src/extensions/browser/main/browser-service'
import type { BrowserTab } from '../../../../src/extensions/browser/main/tab'

const selectors = {
  result: '#b_results > li.b_algo',
  title: 'h2',
  link: 'h2 a[href], a[href]:has(> h2)',
  snippet: '.b_caption p, p.b_algoSlug, p.b_lineclamp2, p.b_lineclamp3',
  nextPage: 'a.sb_pagN[href]'
}

function serviceWithTemporaryTab(tab: Partial<BrowserTab>): BrowserService {
  return {
    withTemporaryTab: vi.fn(
      async (
        _sessionId: string,
        _url: string,
        callback: (temporaryTab: BrowserTab) => Promise<unknown>
      ) => callback(tab as BrowserTab)
    )
  } as unknown as BrowserService
}

describe('web search', () => {
  it('normalizes search result text', () => {
    expect(normalizeWhitespace('\n  TypeScript\t 5.9  ')).toBe('TypeScript 5.9')
    expect(normalizeWhitespace(null)).toBe('')
  })

  it('accepts either a query or a continuation page URL', () => {
    expect(webSearchInputSchema.parse({ query: 'claude code' })).toEqual({
      query: 'claude code',
      selectors
    })
    expect(
      webSearchInputSchema.parse({ pageUrl: 'https://www.bing.com/search?q=test&first=10' })
    ).toEqual({
      pageUrl: 'https://www.bing.com/search?q=test&first=10',
      selectors
    })
    expect(
      webSearchInputSchema.safeParse({ pageUrl: 'file:///D:/search-results.html' }).success
    ).toBe(true)
    expect(webSearchInputSchema.safeParse({ pageUrl: 'D:\\search-results.html' }).success).toBe(
      true
    )
    expect(webSearchInputSchema.safeParse({}).success).toBe(false)
    expect(
      webSearchInputSchema.safeParse({
        query: 'test',
        pageUrl: 'https://www.bing.com/search?q=test'
      }).success
    ).toBe(false)
  })

  it('builds the initial Bing URL', () => {
    const url = new URL(buildBingSearchUrl('claude code'))
    expect(url.origin + url.pathname).toBe('https://www.bing.com/search')
    expect(url.searchParams.get('q')).toBe('claude code')
    expect(url.searchParams.has('first')).toBe(false)
  })

  it('parses, deduplicates, and exposes the next-page URL', () => {
    const dom = new JSDOM(
      `<body>
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://example.com/docs">  Example   Docs </a></h2>
            <div class="b_caption"><p> Useful   documentation. </p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://example.com/docs">Duplicate</a></h2>
          </li>
          <li class="b_algo">
            <h2>Example Org</h2>
            <a class="result-link" href="https://example.org/">Open</a>
          </li>
        </ol>
        <a class="sb_pagN" href="/search?q=test&amp;first=10&amp;FPIG=abc">Next</a>
      </body>`,
      { url: 'https://www.bing.com/search?q=test' }
    )
    vi.stubGlobal('document', dom.window.document)

    expect(
      parseSearchPage({
        ...selectors,
        link: 'h2 a[href], a.result-link'
      })
    ).toEqual({
      results: [
        {
          title: 'Example Docs',
          url: 'https://example.com/docs',
          snippet: 'Useful documentation.'
        },
        {
          title: 'Example Org',
          url: 'https://example.org/'
        }
      ],
      nextPageUrl: 'https://www.bing.com/search?q=test&first=10&FPIG=abc'
    })

    vi.unstubAllGlobals()
  })

  it('uses independent title and link selectors', () => {
    const dom = new JSDOM(
      `<li class="result">
        <h3 class="name"> Example </h3>
        <a class="target" href="https://example.com">Open</a>
        <p class="description"> Description </p>
      </li>`,
      { url: 'https://search.example' }
    )

    expect(
      parseSearchResult(dom.window.document.querySelector('li')!, {
        result: '.result',
        title: '.name',
        link: '.target',
        snippet: '.description',
        nextPage: '.next'
      })
    ).toEqual({
      title: 'Example',
      url: 'https://example.com/',
      snippet: 'Description'
    })
  })

  it('parses a mobile Bing result whose link wraps the title', () => {
    const dom = new JSDOM(
      `<li class="b_algo">
        <a href="https://example.com/mobile"><h2>Mobile result</h2></a>
        <div class="b_caption"><p class="b_lineclamp3">Mobile description</p></div>
      </li>`,
      { url: 'https://www.bing.com/search?q=test' }
    )

    expect(parseSearchResult(dom.window.document.querySelector('li')!, selectors)).toEqual({
      title: 'Mobile result',
      url: 'https://example.com/mobile',
      snippet: 'Mobile description'
    })
  })

  it('skips incomplete results and rejects invalid selectors', () => {
    const dom = new JSDOM(
      `<ol id="results">
        <li><h2>Missing link</h2></li>
        <li><a href="https://example.com">Missing title</a></li>
      </ol>`,
      { url: 'https://search.example' }
    )
    vi.stubGlobal('document', dom.window.document)

    expect(
      parseSearchPage({
        result: '#results > li',
        title: 'h2',
        link: 'a[href]',
        snippet: 'p',
        nextPage: '.next'
      })
    ).toEqual({ results: [] })
    expect(() => parseSearchPage({ ...selectors, result: '[' })).toThrow()

    vi.unstubAllGlobals()
  })

  // Regression guard for the minified-build bug that produced `ReferenceError: Fn is not
  // defined` (the injected script referenced a minified helper name that was out of scope).
  // These asserts ensure the injected script stays self-contained and matches the exported
  // parsing helpers.
  it('builds a self-contained script that parses a page without external references', () => {
    const dom = new JSDOM(
      `<body>
        <ol id="b_results">
          <li class="b_algo"><h2><a href="https://example.com/docs">  Example   Docs </a></h2><div class="b_caption"><p> Useful   documentation. </p></div></li>
          <li class="b_algo"><h2><a href="https://example.com/docs">Duplicate</a></h2></li>
          <li class="b_algo"><h2>No link</h2></li>
        </ol>
        <a class="sb_pagN" href="/search?q=test&amp;first=10&amp;FPIG=abc">Next</a>
      </body>`,
      { url: 'https://www.bing.com/search?q=test' }
    )
    vi.stubGlobal('document', dom.window.document)

    const script = buildParseSearchPageScript(selectors)

    // The serialized script must not splice in module function sources via .toString()
    // (that pattern was the root cause of the `Fn is not defined` failure).
    expect(script).not.toMatch(/\.toString\(\)/)
    // It must not reference bare module helper names either (e.g. compressed `Fn(`).
    expect(script).not.toMatch(/(?<![\w$.])Fn\s*\(/)

    // It must be fully self-contained: evaluating it in a fresh scope parses the page.
    const parsed = eval(script)
    expect(parsed).toEqual({
      results: [
        {
          title: 'Example Docs',
          url: 'https://example.com/docs',
          snippet: 'Useful documentation.'
        }
      ],
      nextPageUrl: 'https://www.bing.com/search?q=test&first=10&FPIG=abc'
    })

    vi.unstubAllGlobals()
  })

  it('injected script parsing matches the exported parsing helpers', () => {
    const dom = new JSDOM(
      `<ol id="b_results">
        <li class="b_algo"><h2><a href="https://example.com/docs">Doc</a></h2><div class="b_caption"><p>A snippet.</p></div></li>
        <li><h2><a href="https://example.org">Org</a></h2></li>
      </ol>`,
      { url: 'https://www.bing.com/search?q=test' }
    )
    vi.stubGlobal('document', dom.window.document)

    const fromInjected = eval(buildParseSearchPageScript(selectors))
    const fromExport = parseSearchPage(selectors)
    expect(fromInjected).toEqual(fromExport)

    vi.unstubAllGlobals()
  })

  it('executes the real injected script end-to-end and parses a page', async () => {
    const dom = new JSDOM(
      `<body>
        <ol id="b_results">
          <li class="b_algo"><h2><a href="https://example.com/docs">  Example   Docs </a></h2><div class="b_caption"><p> Useful   documentation. </p></div></li>
          <li class="b_algo"><h2><a href="https://example.com/docs">Duplicate</a></h2></li>
        </ol>
        <a class="sb_pagN" href="/search?q=test&amp;first=10&amp;FPIG=abc">Next</a>
      </body>`,
      { url: 'https://www.bing.com/search?q=test' }
    )
    vi.stubGlobal('document', dom.window.document)

    // Simulate the real temporary tab: evalJs really evaluates the injected search script.
    const evalJs = vi.fn(async (script: string) => eval(script))
    const service = serviceWithTemporaryTab({ waitForNavigation: vi.fn(async () => undefined), evalJs })

    await expect(
      executeWebSearch(
        service,
        { query: 'test', selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).resolves.toEqual({
      results: [
        {
          title: 'Example Docs',
          url: 'https://example.com/docs',
          snippet: 'Useful documentation.'
        }
      ],
      nextPageUrl: 'https://www.bing.com/search?q=test&first=10&FPIG=abc'
    })

    vi.unstubAllGlobals()
  })

  it('returns one page and continuation metadata without navigating again', async () => {
    const tab = {
      waitForNavigation: vi.fn(async () => undefined),
      navigateAndWait: vi.fn(),
      evalJs: vi.fn(async () => ({
        results: [
          { title: 'One', url: 'https://one.example' },
          { title: 'Two', url: 'https://two.example' }
        ],
        nextPageUrl: 'https://www.bing.com/search?q=test&first=10&FPIG=abc'
      }))
    }
    const service = serviceWithTemporaryTab(tab)

    await expect(
      executeWebSearch(
        service,
        { query: 'test query', selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).resolves.toEqual({
      results: [
        { title: 'One', url: 'https://one.example' },
        { title: 'Two', url: 'https://two.example' }
      ],
      nextPageUrl: 'https://www.bing.com/search?q=test&first=10&FPIG=abc'
    })

    expect(service.withTemporaryTab).toHaveBeenCalledWith(
      'session-1',
      'https://www.bing.com/search?q=test+query',
      expect.any(Function)
    )
    expect(tab.navigateAndWait).not.toHaveBeenCalled()
  })

  it('loads a returned page URL directly', async () => {
    const pageUrl = 'https://www.bing.com/search?q=test&first=10'
    const service = serviceWithTemporaryTab({
      waitForNavigation: vi.fn(async () => undefined),
      evalJs: vi.fn(async () => ({
        results: [{ title: 'One', url: 'https://one.example' }]
      }))
    })

    await expect(
      executeWebSearch(
        service,
        { pageUrl, selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).resolves.toEqual({
      results: [{ title: 'One', url: 'https://one.example' }]
    })
    expect(service.withTemporaryTab).toHaveBeenCalledWith(
      'session-1',
      pageUrl,
      expect.any(Function)
    )
  })

  it('propagates parsing failures from the temporary tab', async () => {
    const service = serviceWithTemporaryTab({
      waitForNavigation: vi.fn(async () => undefined),
      evalJs: vi.fn(async () => {
        throw new Error('parse failed')
      })
    })

    await expect(
      executeWebSearch(
        service,
        { query: 'test', selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).rejects.toThrow('parse failed')
  })

  it('rejects a page with no parseable results', async () => {
    const service = serviceWithTemporaryTab({
      waitForNavigation: vi.fn(async () => undefined),
      evalJs: vi.fn(async () => ({ results: [] }))
    })

    await expect(
      executeWebSearch(
        service,
        { query: 'test', selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace' }
      )
    ).rejects.toThrow('The page returned no parseable search results.')
  })

  it('cancels a pending search', async () => {
    const controller = new AbortController()
    const service = serviceWithTemporaryTab({
      waitForNavigation: vi.fn(() => new Promise<void>(() => {})),
      evalJs: vi.fn()
    })

    const pending = executeWebSearch(
      service,
      { query: 'test', selectors },
      { sessionId: 'session-1', cwd: 'D:\\Workspace', signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toThrow('Web search was cancelled.')
  })

  it('does not create a temporary tab when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const service = serviceWithTemporaryTab({})

    await expect(
      executeWebSearch(
        service,
        { query: 'test', selectors },
        { sessionId: 'session-1', cwd: 'D:\\Workspace', signal: controller.signal }
      )
    ).rejects.toThrow('Web search was cancelled.')
    expect(service.withTemporaryTab).not.toHaveBeenCalled()
  })
})
