import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  type WorkbenchRendererDefinition,
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'

describe('WorkbenchRendererRegistry', () => {
  it('registers and disposes a renderer', () => {
    const registry = createRegistry()
    const Renderer = vi.fn(() => null)
    const definition = {
      component: Renderer,
      icon: null,
      order: 10,
      title: 'Terminal'
    }

    const registration = registry.register('terminal', definition)
    expect(registry.get('terminal')).toBe(definition)

    registration.dispose()
    expect(registry.get('terminal')).toBeUndefined()
  })

  it('rejects duplicate renderer ids without replacing the original', () => {
    const owner = new Registry()
    const onChange = vi.fn()
    owner.subscribe(workbenchRendererRegistryToken, onChange)
    const registry = new WorkbenchRendererRegistry(owner)
    const first = vi.fn(() => null)
    const definition = {
      component: first,
      icon: null,
      order: 10,
      title: 'Terminal'
    }
    registry.register('terminal', definition)

    expect(() =>
      registry.register('terminal', {
        component: vi.fn(() => null),
        icon: null,
        order: 20,
        title: 'Other'
      })
    ).toThrow('Workbench renderer "terminal" is already registered.')
    expect(registry.get('terminal')).toBe(definition)
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('notifies its owner when registrations change', () => {
    const owner = new Registry()
    const listener = vi.fn()
    owner.subscribe(workbenchRendererRegistryToken, listener)
    const registry = new WorkbenchRendererRegistry(owner)
    const registration = registry.register('terminal', {
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title: 'Terminal'
    })
    expect(listener).toHaveBeenCalledOnce()

    registration.dispose()
    expect(listener).toHaveBeenCalledTimes(2)

    registration.dispose()
    registry.get('terminal')
    registry.list()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('lists renderer metadata in declared order', () => {
    const registry = createRegistry()
    const definition = (title: string, order: number): WorkbenchRendererDefinition => ({
      component: vi.fn(() => null),
      icon: null,
      order,
      title
    })
    registry.register('browser', definition('Browser', 20))
    registry.register('terminal', definition('Terminal', 10))

    expect(registry.list().map(([id]) => id)).toEqual(['terminal', 'browser'])
  })

  it('uses renderer id as the stable order tie-breaker', () => {
    const registry = createRegistry()
    const definition = (title: string): WorkbenchRendererDefinition => ({
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title
    })
    registry.register('terminal', definition('Terminal'))
    registry.register('browser', definition('Browser'))

    expect(registry.list().map(([id]) => id)).toEqual(['browser', 'terminal'])
  })

  it('does not let an old registration dispose its replacement', () => {
    const registry = createRegistry()
    const definition = (title: string): WorkbenchRendererDefinition => ({
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title
    })
    const oldRegistration = registry.register('terminal', definition('Old'))
    oldRegistration.dispose()
    const replacement = definition('New')
    registry.register('terminal', replacement)

    oldRegistration.dispose()

    expect(registry.get('terminal')).toBe(replacement)
  })
})

function createRegistry(): WorkbenchRendererRegistry {
  return new WorkbenchRendererRegistry(new Registry())
}
