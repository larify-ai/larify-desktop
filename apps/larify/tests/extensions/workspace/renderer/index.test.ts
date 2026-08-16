// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
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
    for (const mime of ['application/pdf', 'text/html', 'image/png', 'audio/mpeg', 'video/mp4']) {
      expect(previews.find({ binary: false, mime, path: 'file' })?.component).toBe(
        NativeFilePreview
      )
    }

    const textRenderer = previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })
    expect(textRenderer).toBeDefined()
    expect(textRenderer?.component).not.toBe(NativeFilePreview)
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
    expect(previews.find({ binary: false, mime: 'text/plain', path: 'file.txt' })).toBeUndefined()
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
