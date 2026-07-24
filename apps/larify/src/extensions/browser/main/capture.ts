import type { Interactions } from './interactions'
import { getBoxWithSession } from './queries'

export interface ScreenshotOptions {
  selector?: string
  fullPage?: boolean
  format?: 'png' | 'jpeg'
  quality?: number
}

export interface ScreenshotResult {
  data: string
  mimeType: string
}

type Size = { width: number; height: number }

export function mapFrameBoxToTopLevel(
  box: { x: number; y: number; width: number; height: number },
  contentQuad: number[],
  viewport: Size
): { x: number; y: number; width: number; height: number } {
  if (contentQuad.length < 8 || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('Could not get iframe geometry.')
  }
  const point = (x: number, y: number): { x: number; y: number } => ({
    x:
      contentQuad[0] +
      (x / viewport.width) * (contentQuad[2] - contentQuad[0]) +
      (y / viewport.height) * (contentQuad[6] - contentQuad[0]),
    y:
      contentQuad[1] +
      (x / viewport.width) * (contentQuad[3] - contentQuad[1]) +
      (y / viewport.height) * (contentQuad[7] - contentQuad[1])
  })
  const points = [
    point(box.x, box.y),
    point(box.x + box.width, box.y),
    point(box.x + box.width, box.y + box.height),
    point(box.x, box.y + box.height)
  ]
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export async function screenshot(
  ctx: Interactions,
  opts: ScreenshotOptions
): Promise<ScreenshotResult> {
  const format = opts.format ?? 'png'
  const params: Record<string, unknown> = { format, fromSurface: true, optimizeForSpeed: true }
  if (format === 'jpeg') params.quality = opts.quality ?? 80

  if (opts.selector) {
    const resolved = await getBoxWithSession(ctx, opts.selector)
    const box = resolved.box
    const scroll = (await ctx.send('Runtime.evaluate', {
      expression: '({ x: window.scrollX, y: window.scrollY })',
      returnByValue: true
    })) as { result?: { value?: { x: number; y: number } } }
    const offset = scroll.result?.value ?? { x: 0, y: 0 }
    let clipBox = box
    if (resolved.sessionId) {
      if (!resolved.frameId) throw new Error('Could not map iframe session to its frame.')
      const owner = (await ctx.send('DOM.getFrameOwner', {
        frameId: resolved.frameId
      })) as { backendNodeId: number }
      const ownerBox = (await ctx.send('DOM.getBoxModel', {
        backendNodeId: owner.backendNodeId
      })) as { model?: { content?: number[] } }
      const content = ownerBox.model?.content
      const viewportResult = (await ctx.send(
        'Runtime.evaluate',
        {
          expression: '({ width: window.innerWidth, height: window.innerHeight })',
          returnByValue: true
        },
        resolved.sessionId
      )) as { result?: { value?: Size } }
      const viewport = viewportResult.result?.value
      if (!content || !viewport) throw new Error('Could not get iframe geometry.')
      clipBox = mapFrameBoxToTopLevel(box, content, viewport)
    }
    params.clip = {
      x: clipBox.x + offset.x,
      y: clipBox.y + offset.y,
      width: clipBox.width,
      height: clipBox.height,
      scale: 1
    }
    params.captureBeyondViewport = true
  } else if (opts.fullPage) {
    const metrics = (await ctx.send('Page.getLayoutMetrics')) as {
      cssContentSize?: Size
      contentSize?: Size
    }
    const size = metrics.cssContentSize ?? metrics.contentSize
    if (size) {
      params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
      params.captureBeyondViewport = true
    }
  }

  const res = (await ctx.send('Page.captureScreenshot', params)) as { data: string }
  return { data: res.data, mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
}
