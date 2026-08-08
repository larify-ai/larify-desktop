// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSelector } from '../../../src/renderer/src/app/interaction/assistant/workspace-selector'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('WorkspaceSelector', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    Reflect.deleteProperty(window, 'bridge')
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('shows the default space and the selected directory name', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke: vi.fn().mockResolvedValue([]) }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(createElement(WorkspaceSelector, { cwd: '', disabled: false, onChange: vi.fn() }))
    })
    expect(container.textContent).toContain('默认空间')
    expect(container.querySelector('button')?.className).not.toContain('border-b')

    await act(async () => {
      root.render(
        createElement(WorkspaceSelector, {
          cwd: 'D:\\Workspace\\larify-desktop',
          disabled: false,
          onChange: vi.fn()
        })
      )
    })
    expect(container.textContent).toContain('larify-desktop')
  })

  it('locks the selector while the first message is being submitted', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke: vi.fn().mockResolvedValue([]) }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(createElement(WorkspaceSelector, { cwd: '', disabled: true, onChange: vi.fn() }))
    })

    expect(container.querySelector('button')?.disabled).toBe(true)
  })

  it('always offers the default space exactly once', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke: vi.fn().mockResolvedValue(['', 'D:\\Workspace\\project'])
      }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(WorkspaceSelector, {
          cwd: 'D:\\Workspace\\project',
          disabled: false,
          onChange: vi.fn()
        })
      )
    })
    await act(async () => {
      container
        .querySelector('button')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    const items = [...document.querySelectorAll('[role="menuitem"]')]
    expect(items.some((item) => item.textContent?.includes('project'))).toBe(true)
    expect(items.filter((item) => item.textContent?.includes('默认空间'))).toHaveLength(1)
  })

  it('selects a recent workspace and a directory from the system dialog', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'session:cwds'
          ? ['D:\\Workspace\\recent']
          : ['D:\\Workspace\\selected', 'D:\\Workspace\\ignored']
      )
    )
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onChange = vi.fn()

    await act(async () => {
      root.render(createElement(WorkspaceSelector, { cwd: '', disabled: false, onChange }))
    })
    const trigger = container.querySelector('button')!
    const open = async (): Promise<void> => {
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      })
    }

    await open()
    const recent = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'recent'
    )!
    await act(async () => recent.click())
    expect(onChange).toHaveBeenLastCalledWith('D:\\Workspace\\recent')

    await open()
    const selectDirectory = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === '选择其他目录'
    )!
    await act(async () => selectDirectory.click())
    expect(invoke).toHaveBeenCalledWith('dialog:pick-directories')
    expect(onChange).toHaveBeenLastCalledWith('D:\\Workspace\\selected')
  })
})
