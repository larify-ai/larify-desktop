// @vitest-environment jsdom

import { act, createElement, type ReactElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputAttachments,
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
    Reflect.deleteProperty(window, 'fs')
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

  it('marks a dropped directory for the folder icon', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'fs', {
      configurable: true,
      value: { getPathForFile: () => 'C:\\folder' }
    })
    let mediaType: string | undefined

    const Probe = (): null => {
      mediaType = usePromptInputAttachments().files[0]?.mediaType
      return null
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(PromptInput, { onSubmit: () => undefined }, createElement(Probe)))
    })

    const file = new File([], 'folder')
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        items: {
          0: {
            getAsFile: () => file,
            webkitGetAsEntry: () => ({ isDirectory: true })
          },
          length: 1
        },
        types: ['Files']
      }
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(drop)
    })

    expect(mediaType).toBe('inode/directory')
  })
})
