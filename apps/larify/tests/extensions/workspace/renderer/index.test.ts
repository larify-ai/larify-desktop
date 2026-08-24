// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const changesLoaders = vi.hoisted(() => ({
  preloadChangesEditor: vi.fn(() => Promise.resolve())
}))
const gitStatusInvalidation = vi.hoisted(() => ({ invalidateGitStatus: vi.fn() }))

vi.mock(
  '../../../../src/extensions/workspace/renderer/changes/git-status-invalidation',
  () => gitStatusInvalidation
)

vi.mock('../../../../src/extensions/workspace/renderer/preview/markdown-preview', () => ({
  MarkdownPreview: () => createElement('div', { 'data-preview': 'markdown' })
}))
vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco-preview', () => ({
  MonacoPreview: () => createElement('div', { 'data-preview': 'monaco' })
}))
vi.mock('../../../../src/extensions/workspace/renderer/changes/changes-view', () => ({
  ChangesView: (props: { cwd: string; resourceId: number }) =>
    createElement('div', {
      'data-cwd': props.cwd,
      'data-resource-id': props.resourceId,
      'data-testid': 'changes-view'
    })
}))
vi.mock('../../../../src/extensions/workspace/renderer/changes/changes-loaders', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../src/extensions/workspace/renderer/changes/changes-loaders')
  >('../../../../src/extensions/workspace/renderer/changes/changes-loaders')
  return { ...actual, preloadChangesEditor: changesLoaders.preloadChangesEditor }
})
import plugin from '../../../../src/extensions/workspace/renderer'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  PreviewRegistry,
  previewRegistryToken
} from '../../../../src/renderer/src/app/registry/file-previews'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import { RendererPluginHost } from '../../../../src/renderer/src/app/registry/renderer-plugins'

describe('workspace renderer plugin', () => {
  it('invalidates Git status when a terminal command finishes', () => {
    let listener: ((payload: unknown) => void) | undefined
    const unbind = vi.fn()
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        on: vi.fn((_channel: string, callback: (payload: unknown) => void) => {
          listener = callback
          return unbind
        })
      }
    })
    gitStatusInvalidation.invalidateGitStatus.mockClear()
    try {
      const { registry, subscriptions } = createServices()
      plugin.activate({ registry, subscriptions })

      listener?.({ cwd: 'D:\\workspace' })

      expect(gitStatusInvalidation.invalidateGitStatus).toHaveBeenCalledWith('D:\\workspace')
      subscriptions.forEach(({ dispose }) => dispose())
      expect(unbind).toHaveBeenCalledOnce()
    } finally {
      Reflect.deleteProperty(window, 'bridge')
    }
  })

  it('does not schedule eager loading without the idle callback API', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    changesLoaders.preloadChangesEditor.mockClear()
    try {
      const { registry, subscriptions } = createServices()

      plugin.activate({ registry, subscriptions })

      expect(changesLoaders.preloadChangesEditor).not.toHaveBeenCalled()
      expect(subscriptions).toHaveLength(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preloads the changes editor only after the idle callback runs', async () => {
    let idleCallback: IdleRequestCallback | undefined
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback
        return 42
      })
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    changesLoaders.preloadChangesEditor.mockClear()
    try {
      const { registry } = createServices()
      plugin.activate({ registry, subscriptions: [] })

      expect(changesLoaders.preloadChangesEditor).not.toHaveBeenCalled()
      await idleCallback?.({ didTimeout: false, timeRemaining: () => 10 })
      expect(changesLoaders.preloadChangesEditor).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('contains idle preload failures because opening the editor remains lazy', async () => {
    let idleCallback: IdleRequestCallback | undefined
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback
        return 42
      })
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    changesLoaders.preloadChangesEditor.mockClear()
    changesLoaders.preloadChangesEditor.mockRejectedValueOnce(new Error('preload failed'))
    try {
      const { registry } = createServices()
      plugin.activate({ registry, subscriptions: [] })

      await idleCallback?.({ didTimeout: false, timeRemaining: () => 10 })
      await Promise.resolve()
      expect(changesLoaders.preloadChangesEditor).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('cancels the scheduled editor preload when disposed before idle', () => {
    const requestIdle = vi.fn(() => 42)
    const cancelIdle = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdle)
    vi.stubGlobal('cancelIdleCallback', cancelIdle)
    try {
      const { registry, subscriptions } = createServices()

      plugin.activate({ registry, subscriptions })
      subscriptions[0].dispose()

      expect(requestIdle).toHaveBeenCalledWith(expect.any(Function))
      expect(cancelIdle).toHaveBeenCalledWith(42)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('registers the workbench and selects previews by MIME and binary state', () => {
    const { previews, registry, renderers, subscriptions } = createServices()

    plugin.activate({ registry, subscriptions })

    expect(renderers.get('workspace')).toMatchObject({ order: 10, title: '文件' })
    expect(renderers.get('changes')).toMatchObject({ order: 20, title: '变更' })
    expect(renderers.get('workspace')?.icon).toMatchObject({
      props: { className: 'larify-workbench-icon-file' }
    })
    expect(renderers.get('changes')?.icon).toMatchObject({
      props: { className: 'larify-workbench-icon-changes' }
    })
    for (const mime of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4']) {
      expect(previews.find({ binary: true, mime, path: 'file' })).toBeUndefined()
    }

    const textRenderer = previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })
    expect(textRenderer).toBeDefined()
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
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'notes.markdown' })).toBe(
      markdownRenderer
    )
    expect(previews.find({ binary: false, mime: 'text/markdown', path: 'notes.txt' })).toBe(
      markdownRenderer
    )
    const typescriptRenderer = previews.find({
      binary: false,
      mime: 'video/mp2t',
      path: 'workspace-link.ts'
    })
    expect(typescriptRenderer).toBe(textRenderer)
    expect(
      previews.find({ binary: true, mime: 'application/octet-stream', path: 'README.md' })
    ).toBeUndefined()
    expect(
      previews.find({ binary: true, mime: 'text/markdown', path: 'README.md' })
    ).toBeUndefined()
    const htmlRenderer = previews.find({ binary: false, mime: 'text/html', path: 'page.html' })
    expect(htmlRenderer).toBe(textRenderer)
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
    expect(renderers.get('changes')).toBeUndefined()
    expect(
      previews.find({ binary: true, mime: 'application/pdf', path: 'file.pdf' })
    ).toBeUndefined()
    expect(
      previews.find({ binary: false, mime: 'text/markdown', path: 'README.md' })
    ).toBeUndefined()
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })).toBeUndefined()
  })

  it('renders the changes view with its complete workbench props', async () => {
    const { registry, renderers, subscriptions } = createServices()
    plugin.activate({ registry, subscriptions })
    const renderer = renderers.get('changes')!
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(renderer.component, {
          active: true,
          cwd: 'D:\\workspace',
          resourceId: 8,
          sessionId: 'session',
          updateTab: vi.fn()
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="changes-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="changes-view"]')?.getAttribute('data-cwd')).toBe(
      'D:\\workspace'
    )
    expect(
      container.querySelector('[data-testid="changes-view"]')?.getAttribute('data-resource-id')
    ).toBe('8')
    await act(async () => root.unmount())
  })

  it('rolls back workspace registration when changes registration conflicts', () => {
    const { previews, registry, renderers } = createServices()
    const existing = renderers.register('changes', {
      component: () => createElement('div'),
      icon: null,
      order: 1,
      title: 'existing'
    })
    const host = new RendererPluginHost(registry)

    expect(() => host.activate(plugin)).toThrow(
      'Workbench renderer "changes" is already registered.'
    )
    expect(renderers.get('workspace')).toBeUndefined()
    expect(renderers.get('changes')?.title).toBe('existing')
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })).toBeUndefined()
    existing.dispose()
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
