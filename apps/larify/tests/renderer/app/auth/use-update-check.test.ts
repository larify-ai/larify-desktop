// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdateCheck } from '../../../../src/renderer/src/app/auth/use-update-check'

const handlers: Record<string, (payload?: unknown) => void> = {}
let container: HTMLDivElement
let root: Root

function Harness(): React.JSX.Element {
  const update = useUpdateCheck()
  return createElement(
    'div',
    {
      'data-status': update.status,
      'data-progress': update.progress ? String(update.progress.percent) : '',
      'data-version': update.version ?? '',
      'data-dialog': String(update.dialogOpen)
    },
    createElement('button', { onClick: () => void update.checkForUpdates() }, 'check'),
    createElement('button', { onClick: () => update.installUpdate() }, 'install')
  )
}

function host(): HTMLElement | null {
  return container.querySelector('[data-status]')
}

function button(text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text
  ) as HTMLButtonElement
}

describe('useUpdateCheck', () => {
  beforeEach(() => {
    const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    global.IS_REACT_ACT_ENVIRONMENT = true
    for (const key of Object.keys(handlers)) delete handlers[key]
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    window.bridge = {
      invoke: vi
        .fn()
        .mockImplementation((channel: string) =>
          channel === 'update:downloadedVersion' ? Promise.resolve(null) : Promise.resolve({})
        ),
      on: (channel: string, listener: (payload?: unknown) => void) => {
        handlers[channel] = listener
        return () => {
          delete handlers[channel]
        }
      }
    } as unknown as typeof window.bridge
    act(() => root.render(createElement(Harness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('exposes the initial update view', () => {
    expect(host()?.dataset.status).toBe('')
    expect(host()?.dataset.progress).toBe('')
    expect(host()?.dataset.dialog).toBe('false')
  })

  it('reflects progress events into the progress state', () => {
    act(() => handlers['update:progress']({ percent: 60 }))
    expect(host()?.dataset.progress).toBe('60')
  })

  it('opens the restart dialog and clears progress on ready', () => {
    act(() => handlers['update:progress']({ percent: 90 }))
    act(() => handlers['update:ready']('2.0.0'))
    expect(host()?.dataset.dialog).toBe('true')
    expect(host()?.dataset.version).toBe('2.0.0')
    expect(host()?.dataset.progress).toBe('')
  })

  it('surfaces an error and clears progress', () => {
    act(() => handlers['update:error']('下载失败'))
    expect(host()?.dataset.status).toBe('下载失败')
    expect(host()?.dataset.progress).toBe('')
  })

  it('reports an available update after checkForUpdates', async () => {
    ;(window.bridge.invoke as ReturnType<typeof vi.fn>).mockImplementation((channel: string) =>
      channel === 'update:check'
        ? Promise.resolve({ status: 'available', version: '4.0.0' })
        : Promise.resolve(null)
    )
    await act(async () => {
      button('check').click()
    })
    expect(host()?.dataset.status).toBe('发现 4.0.0')
  })

  it('calls update:install from installUpdate', () => {
    act(() => button('install').click())
    expect(window.bridge.invoke).toHaveBeenCalledWith('update:install')
  })
})
