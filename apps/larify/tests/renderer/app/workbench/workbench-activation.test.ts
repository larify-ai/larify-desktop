// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  useWorkbenchActivation,
  WorkbenchActivationProvider,
  useWorkbenchActivationStore
} from '../../../../src/renderer/src/app/workbench/workbench-activation'

describe('workbench activation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('uses the fallback outside a provider', async () => {
    await act(async () => root.render(createElement(ActivationProbe, { fallback: false })))

    expect(container.textContent).toBe('inactive')
  })

  it('notifies activation consumers when the provider changes', async () => {
    let probeRenders = 0
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            WorkbenchActivationProvider,
            { active },
            createElement(ActivationProbe, {
              onRender: () => {
                probeRenders += 1
              }
            })
          )
        )
      })
    }

    await render(true)
    const initialRenders = probeRenders
    await render(false)

    expect(container.textContent).toBe('inactive')
    expect(probeRenders).toBeGreaterThan(initialRenders)
  })

  it('keeps one store and does not notify when activation is unchanged', async () => {
    const stores: unknown[] = []
    let notifications = 0
    const StoreProbe = (): null => {
      const store = useWorkbenchActivationStore()
      stores.push(store)
      useEffect(() => store?.subscribe(() => notifications++), [store])
      return null
    }
    const render = async (active: boolean): Promise<void> => {
      await act(async () =>
        root.render(
          createElement(WorkbenchActivationProvider, { active }, createElement(StoreProbe))
        )
      )
    }

    await render(true)
    await render(true)
    expect(new Set(stores).size).toBe(1)
    expect(notifications).toBe(0)

    await render(false)
    expect(new Set(stores).size).toBe(1)
    expect(notifications).toBe(1)
  })
})

function ActivationProbe({
  fallback,
  onRender
}: {
  fallback?: boolean
  onRender?: () => void
}): React.JSX.Element {
  const active = useWorkbenchActivation(fallback)
  onRender?.()
  return createElement('span', null, active ? 'active' : 'inactive')
}
