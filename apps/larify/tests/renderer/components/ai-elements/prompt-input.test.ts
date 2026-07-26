// @vitest-environment jsdom

import { act, createElement, type ReactElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputController
} from '../../../../src/renderer/src/components/ai-elements/prompt-input'

const reactEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('PromptInputProvider', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('removes a registered file dialog callback when its owner unmounts', () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const open = vi.fn()
    let openFileDialog: (() => void) | undefined

    const Registration = (): null => {
      const controller = usePromptInputController()

      useEffect(() => controller.__registerFileInput({ current: null }, open), [controller])

      return null
    }

    const Probe = ({ registered }: { registered: boolean }): ReactElement | null => {
      const controller = usePromptInputController()
      openFileDialog = controller.attachments.openFileDialog
      return registered ? createElement(Registration) : null
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root.render(
        createElement(
          PromptInputProvider,
          null,
          createElement(Probe, { registered: true })
        )
      )
    })
    act(() => openFileDialog?.())
    expect(open).toHaveBeenCalledOnce()

    act(() => {
      root.render(
        createElement(
          PromptInputProvider,
          null,
          createElement(Probe, { registered: false })
        )
      )
    })
    act(() => openFileDialog?.())
    expect(open).toHaveBeenCalledOnce()
  })

  it('restores local text when submission fails', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { onSubmit: () => Promise.reject(new Error('failed')) },
          createElement(PromptInputTextarea)
        )
      )
    })

    const textarea = container.querySelector('textarea')
    const form = container.querySelector('form')
    expect(textarea).not.toBeNull()
    expect(form).not.toBeNull()

    textarea!.value = 'retry this'
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(textarea!.value).toBe('retry this')
  })
})
