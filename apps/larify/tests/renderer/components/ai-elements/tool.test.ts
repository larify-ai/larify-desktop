// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolIcon,
  ToolInput,
  ToolOutput
} from '../../../../src/renderer/src/components/ai-elements/tool'

describe('Tool', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders the ask-user icon and a custom status label', async () => {
    await renderHeader({ icon: 'message-square-text', statusLabel: '等待回答' })

    expect(container.querySelector('.lucide-message-square-text')).not.toBeNull()
    expect(container.textContent).toContain('等待回答')
    expect(container.textContent).not.toContain('运行中')
  })

  it('falls back to the generic tool icon for an unknown icon name', async () => {
    await renderHeader({ icon: 'unknown' })

    expect(container.querySelector('.lucide-wrench')).not.toBeNull()
    expect(container.textContent).toContain('运行中')
  })

  it('keeps heavy tool content out of the collapsed wrapper', async () => {
    await renderTool()

    expect(container.textContent).not.toContain('details')
    expect(
      container.querySelector('[data-slot="collapsible-content"]')?.getAttribute('data-state')
    ).toBe('closed')
  })

  it('opens and closes an uncontrolled tool from its trigger', async () => {
    await renderTool()

    await clickTrigger()
    expect(container.textContent).toContain('details')
    expect(container.querySelector('[data-slot="collapsible-content"]')).not.toBeNull()

    await clickTrigger()
    expect(container.textContent).not.toContain('details')
  })

  it('reports controlled changes without changing its own open state', async () => {
    const onOpenChange = vi.fn()
    await renderTool({ open: false, onOpenChange })

    await clickTrigger()

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(container.textContent).not.toContain('details')
  })

  it('forwards icon accessibility properties', async () => {
    await act(async () => {
      root.render(createElement(ToolIcon, { kind: 'read', 'aria-label': 'Read file' }))
    })

    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Read file')
    expect(container.querySelector('.lucide-file-text')).not.toBeNull()
  })

  it('removes the display title from serialized tool input', async () => {
    await act(async () => {
      root.render(createElement(ToolInput, { input: { title: 'Display title', value: 1 } }))
    })

    expect(container.textContent).toContain('value')
    expect(container.textContent).not.toContain('Display title')
  })

  it.each([
    ['zero', 0, '0'],
    ['false', false, 'false']
  ])('renders a %s tool output', async (_name, output, expected) => {
    await act(async () => {
      root.render(createElement(ToolOutput, { output, errorText: undefined }))
    })

    expect(container.textContent).toContain('结果')
    expect(container.textContent).toContain(expected)
  })

  it('renders error text when no output is available', async () => {
    await act(async () => {
      root.render(createElement(ToolOutput, { output: undefined, errorText: 'Failed' }))
    })

    expect(container.textContent).toContain('错误')
    expect(container.textContent).toContain('Failed')
  })

  async function renderTool(
    props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          Tool,
          props,
          createElement(ToolHeader, {
            state: 'input-available',
            toolName: 'fs_read',
            type: 'dynamic-tool'
          }),
          createElement(ToolContent, null, 'details')
        )
      )
    })
  }

  async function clickTrigger(): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    })
  }

  async function renderHeader({
    icon,
    statusLabel
  }: {
    icon: string
    statusLabel?: string
  }): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          Tool,
          null,
          createElement(ToolHeader, {
            icon,
            state: 'input-available',
            statusLabel,
            toolName: 'agent_ask_user',
            type: 'dynamic-tool'
          })
        )
      )
    })
  }
})
