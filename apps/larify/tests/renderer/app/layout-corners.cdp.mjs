/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'

import { connectLarifyCdp } from '../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()

const distance = (pixel, color) =>
  Math.hypot(pixel[0] - color[0], pixel[1] - color[1], pixel[2] - color[2])

try {
  const geometry = await cdp.evaluate(`(() => {
    const surface = document.querySelector('.larify-main-surface')
    const top = document.querySelector('.larify-main-surface-corner-top')
    const bottom = document.querySelector('.larify-main-surface-corner-bottom')
    if (!surface || !top || !bottom) return null
    const surfaceRect = surface.getBoundingClientRect()
    const topRect = top.getBoundingClientRect()
    const bottomRect = bottom.getBoundingClientRect()
    return {
      dpr: devicePixelRatio,
      surface: { left: surfaceRect.left, top: surfaceRect.top, bottom: surfaceRect.bottom },
      top: { left: topRect.left, top: topRect.top, width: topRect.width, height: topRect.height },
      bottom: { left: bottomRect.left, top: bottomRect.top, width: bottomRect.width, height: bottomRect.height },
      outlineWidth: getComputedStyle(surface).outlineWidth
    }
  })()`)

  assert.ok(geometry, 'main surface corners should be visible')
  assert.deepEqual(geometry.top, {
    left: geometry.surface.left,
    top: geometry.surface.top,
    width: 12,
    height: 12
  })
  assert.equal(geometry.bottom.left, geometry.surface.left)
  assert.equal(geometry.bottom.top + geometry.bottom.height, geometry.surface.bottom)
  assert.equal(geometry.bottom.width, 12)
  assert.equal(geometry.bottom.height, 12)
  const physicalEdges = {
    bottomStart: geometry.bottom.top * geometry.dpr,
    bottomTangent: (geometry.bottom.left + geometry.bottom.width) * geometry.dpr,
    left: geometry.surface.left * geometry.dpr,
    topTangent: (geometry.top.left + geometry.top.width) * geometry.dpr
  }
  const fixtures = await cdp.evaluate(`(() => {
    document.querySelector('#larify-corner-test-fixtures')?.remove()
    const host = document.createElement('div')
    host.id = 'larify-corner-test-fixtures'
    host.style.cssText = 'position:fixed;z-index:2147483647;left:400px;top:400px;display:flex;gap:20px'
    const makeFixture = (placement) => {
      const surface = document.createElement('div')
      surface.className = 'larify-main-surface'
      surface.style.cssText = 'position:relative;width:40px;height:40px;background:var(--background)'
      const corner = document.querySelector('.larify-main-surface-corner-' + placement).cloneNode(true)
      surface.append(corner)
      host.append(surface)
      return corner
    }
    const top = makeFixture('top')
    const bottom = makeFixture('bottom')
    document.body.append(host)
    const rect = (element) => {
      const value = element.getBoundingClientRect()
      return { left: value.left, top: value.top, width: value.width, height: value.height }
    }
    const surface = top.parentElement
    const borderProbe = document.createElement('span')
    borderProbe.style.color = 'var(--border-strong)'
    surface.append(borderProbe)
    return {
      colors: {
        border: getComputedStyle(borderProbe).color,
        main: getComputedStyle(surface).backgroundColor,
        sidebar: getComputedStyle(top).backgroundColor
      },
      top: rect(top),
      bottom: rect(bottom)
    }
  })()`)

  const rgb = (value) =>
    value
      .match(/\d+(?:\.\d+)?/g)
      .slice(0, 3)
      .map(Number)

  const verifyCorner = async (corner, name) => {
    const margin = 3
    const clip = {
      x: corner.left,
      y: corner.top - margin,
      width: corner.width + margin,
      height: corner.height + margin * 2,
      scale: 1
    }
    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip
    })
    const png = PNG.sync.read(Buffer.from(capture.data, 'base64'))
    if (process.env.LARIFY_CORNER_SCREENSHOT_DIR) {
      await mkdir(process.env.LARIFY_CORNER_SCREENSHOT_DIR, { recursive: true })
      await writeFile(
        join(process.env.LARIFY_CORNER_SCREENSHOT_DIR, `${name}.png`),
        PNG.sync.write(png)
      )
    }
    const scaleX = png.width / clip.width
    const scaleY = png.height / clip.height
    const pixelAt = (x, y) => {
      const offset = (y * png.width + x) * 4
      return [png.data[offset], png.data[offset + 1], png.data[offset + 2]]
    }
    const border = rgb(fixtures.colors.border)
    const main = rgb(fixtures.colors.main)
    const sidebar = rgb(fixtures.colors.sidebar)
    const endpointY = Math.round((name === 'top' ? margin + 12 : margin) * scaleY)
    const endpointPixels = []
    for (let y = Math.max(0, endpointY - 3); y <= Math.min(png.height - 1, endpointY + 3); y += 1) {
      for (let x = 0; x <= Math.ceil(3 * scaleX); x += 1) endpointPixels.push(pixelAt(x, y))
    }
    const darkEndpointPixels = endpointPixels.filter(
      (pixel) =>
        distance(pixel, border) + 4 < Math.min(distance(pixel, main), distance(pixel, sidebar))
    )
    assert.equal(darkEndpointPixels.length, 0, `${name} corner must not leave a dark hook`)

    const horizontalY = Math.round((name === 'top' ? margin : margin + 12) * scaleY)
    const prematureBorder = []
    for (let cssX = 1; cssX <= 10; cssX += 1) {
      const pixel = pixelAt(Math.round(cssX * scaleX), horizontalY)
      if (distance(pixel, border) + 4 < distance(pixel, sidebar)) {
        prematureBorder.push({ cssX, pixel })
      }
    }
    assert.deepEqual(
      prematureBorder,
      [],
      `${name} horizontal border must start at the 12px corner tangent`
    )

    const outside = pixelAt(
      Math.round(2 * scaleX),
      Math.round((name === 'top' ? margin + 2 : margin + 10) * scaleY)
    )
    const inside = pixelAt(
      Math.round(10 * scaleX),
      Math.round((name === 'top' ? margin + 10 : margin + 3) * scaleY)
    )
    assert.ok(distance(outside, sidebar) < 8, `${name} outside should retain the sidebar color`)
    assert.ok(distance(inside, main) < 8, `${name} inside should retain the main color`)
    return { darkEndpointPixels: 0, height: png.height, width: png.width }
  }

  const top = await verifyCorner(fixtures.top, 'top')
  const bottom = await verifyCorner(fixtures.bottom, 'bottom')

  const verifyRealBorderStart = async (name, y) => {
    const size = 20
    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: { height: size, scale: 1, width: size, x: geometry.surface.left, y }
    })
    const png = PNG.sync.read(Buffer.from(capture.data, 'base64'))
    if (process.env.LARIFY_CORNER_SCREENSHOT_DIR) {
      await mkdir(process.env.LARIFY_CORNER_SCREENSHOT_DIR, { recursive: true })
      await writeFile(
        join(process.env.LARIFY_CORNER_SCREENSHOT_DIR, `real-${name}.png`),
        PNG.sync.write(png)
      )
    }
    const scale = png.width / size
    const row = name === 'top' ? 0 : png.height - 1
    const tangent = Math.round(12 * scale)
    const pixelAt = (x, pixelY) => {
      const offset = (pixelY * png.width + x) * 4
      return [png.data[offset], png.data[offset + 1], png.data[offset + 2]]
    }
    const border = pixelAt(Math.min(png.width - 1, tangent + Math.round(3 * scale)), row)
    const main = pixelAt(
      Math.min(png.width - 1, tangent + Math.round(3 * scale)),
      Math.round(5 * scale)
    )
    const sidebar = pixelAt(0, name === 'top' ? Math.round(5 * scale) : Math.round(15 * scale))
    const borderPixels = []
    for (let x = 0; x < png.width; x += 1) {
      const pixel = pixelAt(x, row)
      if (distance(pixel, border) + 3 < Math.min(distance(pixel, main), distance(pixel, sidebar))) {
        borderPixels.push(x)
      }
    }
    assert.ok(borderPixels.length, `${name} border should be visible`)
    assert.ok(
      Math.abs(borderPixels[0] - tangent) <= 1,
      `${name} border must start at physical tangent ${tangent}, received ${borderPixels[0]}`
    )
    assert.equal(
      borderPixels.some((x) => x < tangent - 1),
      false,
      `${name} border must not extend into the rounded corner`
    )
    return { firstBorderPixel: borderPixels[0], tangent }
  }

  const realTop = await verifyRealBorderStart('top', geometry.surface.top)
  const realBottom = await verifyRealBorderStart('bottom', geometry.surface.bottom - 20)
  console.log(
    JSON.stringify({ dpr: geometry.dpr, physicalEdges, realBottom, realTop, top, bottom }, null, 2)
  )
} finally {
  await cdp
    .evaluate(`document.querySelector('#larify-corner-test-fixtures')?.remove()`)
    .catch(() => {})
  cdp.close()
}
