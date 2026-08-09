// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Tool, ToolHeader } from '../../../../src/renderer/src/components/ai-elements/tool'

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
