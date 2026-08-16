// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../../src/extensions/workspace/renderer/preview/markdown-preview', () => ({
  MarkdownPreview: () => createElement('div', { 'data-preview': 'markdown' })
}))
vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco-preview', () => ({
  MonacoPreview: () => createElement('div', { 'data-preview': 'monaco' })
}))
import plugin from '../../../../src/extensions/workspace/renderer'
import { NativeFilePreview } from '../../../../src/extensions/workspace/renderer/preview/native-file-preview'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  PreviewRegistry,
  previewRegistryToken
} from '../../../../src/renderer/src/app/registry/file-previews'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'

describe('workspace renderer plugin', () => {
  it('registers the workbench and selects previews by MIME and binary state', () => {
    const { previews, registry, renderers, subscriptions } = createServices()

    plugin.activate({ registry, subscriptions })

    expect(renderers.get('workspace')).toMatchObject({ order: 30, title: '文件' })
    for (const mime of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4']) {
      expect(previews.find({ binary: false, mime, path: 'file' })?.component).toBe(
        NativeFilePreview
      )
    }

    const textRenderer = previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })
    expect(textRenderer).toBeDefined()
    expect(textRenderer?.component).not.toBe(NativeFilePreview)
    const markdownRenderer = previews.find({
      binary: false,
      mime: 'text/markdown',
      path: 'README.md'
    })
    expect(markdownRenderer).toBeDefined()
    expect(markdownRenderer).not.toBe(textRenderer)
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'README.MD' })).toBe(
      markdownRenderer
    )
    expect(previews.find({ binary: false, mime: 'text/markdown', path: 'notes.txt' })).toBe(
      markdownRenderer
    )
    for (const mime of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4']) {
      expect(previews.find({ binary: false, mime, path: 'README.md' })?.component).toBe(
        NativeFilePreview
      )
    }
    expect(
      previews.find({ binary: true, mime: 'application/octet-stream', path: 'README.md' })
    ).toBeUndefined()
    expect(
      previews.find({ binary: true, mime: 'text/markdown', path: 'README.md' })
    ).toBeUndefined()
    const htmlRenderer = previews.find({ binary: false, mime: 'text/html', path: 'page.html' })
    expect(htmlRenderer).toBe(textRenderer)
    expect(htmlRenderer?.component).not.toBe(NativeFilePreview)
    expect(
      previews.find({ binary: false, mime: 'application/octet-stream', path: 'unknown' })
    ).toBe(textRenderer)
    expect(
      previews.find({ binary: true, mime: 'application/octet-stream', path: 'unknown.bin' })
    ).toBeUndefined()
  })

  it('disposes every registered renderer', async () => {
    const { previews, registry, renderers, subscriptions } = createServices()
    plugin.activate({ registry, subscriptions })

    for (const subscription of [...subscriptions].reverse()) await subscription.dispose()

    expect(renderers.get('workspace')).toBeUndefined()
    expect(
      previews.find({ binary: true, mime: 'application/pdf', path: 'file.pdf' })
    ).toBeUndefined()
    expect(
      previews.find({ binary: false, mime: 'text/markdown', path: 'README.md' })
    ).toBeUndefined()
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })).toBeUndefined()
  })

  it('switches Markdown between reading and source renderers', async () => {
    const { previews, registry, subscriptions } = createServices()
    plugin.activate({ registry, subscriptions })
    const renderer = previews.find({ binary: false, mime: 'text/markdown', path: 'README.md' })!
    const container = document.createElement('div')
    const root = createRoot(container)
    const props = {
      file: { binary: false, mime: 'text/markdown', path: 'README.md' },
      resourceId: 7
    }

    await act(async () => {
      root.render(createElement(renderer.component, props))
      await Promise.resolve()
    })
    expect(container.querySelector('[data-preview="markdown"]')).not.toBeNull()

    await act(async () => {
      root.render(createElement(renderer.component, { ...props, mode: 'source' }))
      await Promise.resolve()
    })
    expect(container.querySelector('[data-preview="monaco"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('requires both renderer registries', () => {
    expect(() => plugin.activate({ registry: new Registry(), subscriptions: [] })).toThrow(
      'Workbench renderer registry is unavailable.'
    )

    const registry = new Registry()
    registry.register(workbenchRendererRegistryToken, new WorkbenchRendererRegistry(registry))
    expect(() => plugin.activate({ registry, subscriptions: [] })).toThrow(
      'Preview registry is unavailable.'
    )
  })
})

function createServices(): {
  previews: PreviewRegistry
  registry: Registry
  renderers: WorkbenchRendererRegistry
  subscriptions: Array<{ dispose(): void | Promise<void> }>
} {
  const registry = new Registry()
  const previews = new PreviewRegistry()
  const renderers = new WorkbenchRendererRegistry(registry)
  registry.register(previewRegistryToken, previews)
  registry.register(workbenchRendererRegistryToken, renderers)
  return { previews, registry, renderers, subscriptions: [] }
}
