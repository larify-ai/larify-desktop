import type { Interactions } from './interactions'
import { getBox } from './queries'

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

export async function screenshot(
  ctx: Interactions,
  opts: ScreenshotOptions
): Promise<ScreenshotResult> {
  const format = opts.format ?? 'png'
  const params: Record<string, unknown> = { format, fromSurface: true, optimizeForSpeed: true }
  if (format === 'jpeg') params.quality = opts.quality ?? 80

  if (opts.selector) {
    const box = await getBox(ctx, opts.selector)
    params.clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
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
