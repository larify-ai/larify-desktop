// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageLinkContextProvider } from '../../../../../src/renderer/src/app/interaction/assistant/message-links'
import { MessageMarkdown } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/message-markdown'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('MessageMarkdown', () => {
  const containers: HTMLDivElement[] = []

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove())
  })

  it('turns a completed streaming Windows link into a stable clickable file link', async () => {
    const container = document.createElement('div')
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)
    const onOpenLink = vi.fn()
    const render = async (markdown: string, isAnimating: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            MessageLinkContextProvider,
            { value: onOpenLink },
            createElement(MessageMarkdown, { isAnimating }, markdown)
          )
        )
      })
    }

    await render('[file](D:\\Workspace\\still-streaming', true)
    expect(container.querySelector('button')).toBeNull()

    const completed = '[file](D:\\Workspace\\project\\README.md)'
    await render(completed, true)
    await vi.waitFor(() => expect(container.querySelector('button')).not.toBeNull())

    await render(completed, false)
    const button = container.querySelector('button')!
    await act(async () => button.click())
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith({
      kind: 'file',
      target: 'D:/Workspace/project/README.md'
    })

    await act(async () => root.unmount())
  })
})
