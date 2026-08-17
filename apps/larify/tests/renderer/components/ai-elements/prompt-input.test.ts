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
    vi.unstubAllGlobals()
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

  it('preserves provider text entered while a submission is pending', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    let setInput: ((value: string) => void) | undefined
    let finish: (() => void) | undefined
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const Probe = (): null => {
      setInput = usePromptInputController().textInput.setInput
      return null
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          PromptInputProvider,
          { initialInput: 'first' },
          createElement(
            PromptInput,
            { onSubmit: submit },
            createElement(PromptInputTextarea),
            createElement(Probe)
          )
        )
      )
    })

    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('textarea')!.value).toBe('')

    await act(async () => setInput?.('second'))
    await act(async () => finish?.())

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'first' }),
      expect.anything()
    )
    expect(container.querySelector('textarea')!.value).toBe('second')
  })

  it('ignores another submission while the current submission is pending', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    let finish: (() => void) | undefined
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { onSubmit: submit },
          createElement(PromptInputTextarea)
        )
      )
    })

    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(submit).toHaveBeenCalledOnce()
    await act(async () => finish?.())
  })

  it('does not clear attachments added for the next message', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:next-attachment',
      revokeObjectURL: vi.fn()
    })
    let add: ((files: File[]) => void) | undefined
    let fileCount = 0
    let finish: (() => void) | undefined
    const Probe = (): null => {
      const attachments = usePromptInputAttachments()
      add = attachments.add
      fileCount = attachments.files.length
      return null
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          {
            onSubmit: () =>
              new Promise<void>((resolve) => {
                finish = resolve
              })
          },
          createElement(PromptInputTextarea),
          createElement(Probe)
        )
      )
    })

    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => add?.([new File(['next'], 'next.txt')]))
    await act(async () => finish?.())

    expect(fileCount).toBe(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('keeps attachments when submission fails', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:failed-attachment',
      revokeObjectURL: vi.fn()
    })
    let add: ((files: File[]) => void) | undefined
    let fileCount = 0

    const Probe = (): null => {
      const attachments = usePromptInputAttachments()
      add = attachments.add
      fileCount = attachments.files.length
      return null
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { onSubmit: () => Promise.reject(new Error('failed')) },
          createElement(PromptInputTextarea),
          createElement(Probe)
        )
      )
    })

    await act(async () => add?.([new File(['attachment'], 'attachment.txt')]))
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(fileCount).toBe(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
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
        getData: () => '',
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

  it('adds a file dragged from the workspace tree', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    let attachment: { filename?: string; url: string } | undefined

    const Probe = (): null => {
      attachment = usePromptInputAttachments().files[0]
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(PromptInput, { onSubmit: () => undefined }, createElement(Probe)))
    })

    const path = 'D:\\工作区\\源码\\文件.ts'
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [],
        getData: (type: string) =>
          (type === 'application/x-larify-workspace-entry'
            ? JSON.stringify({ directory: false, name: '文件.ts', path })
            : ''),
        items: [],
        types: ['application/x-larify-workspace-entry']
      }
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(drop)
    })

    expect(attachment).toMatchObject({ filename: '文件.ts', url: path })
  })

  it('adds a directory dragged from the workspace tree', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    let mediaType: string | undefined

    const Probe = (): null => {
      mediaType = usePromptInputAttachments().files[0]?.mediaType
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(PromptInput, { onSubmit: () => undefined }, createElement(Probe)))
    })

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [],
        getData: () =>
          JSON.stringify({ directory: true, name: 'src', path: 'D:\\workspace\\src' }),
        items: [],
        types: ['application/x-larify-workspace-entry']
      }
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(drop)
    })

    expect(mediaType).toBe('inode/directory')
  })

  it('handles workspace tree drops globally when requested', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    let fileCount = 0

    const Probe = (): null => {
      fileCount = usePromptInputAttachments().files.length
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { globalDrop: true, onSubmit: () => undefined },
          createElement(Probe)
        )
      )
    })

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () =>
          JSON.stringify({ directory: false, name: 'file.ts', path: 'D:\\workspace\\file.ts' }),
        types: ['application/x-larify-workspace-entry']
      }
    })
    await act(async () => {
      document.body.dispatchEvent(drop)
    })

    expect(drop.defaultPrevented).toBe(true)
    expect(fileCount).toBe(1)
  })

  it('submits pasted images as unnamed data URLs without fetching blob URLs', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:pasted-image',
      revokeObjectURL: vi.fn()
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const submit = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { onSubmit: submit },
          createElement(PromptInputTextarea)
        )
      )
    })

    const image = new File(['image'], 'image.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => image }] }
    })
    await act(async () => {
      container.querySelector('textarea')!.dispatchEvent(paste)
    })
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
    })

    expect(submit).toHaveBeenCalledWith(
      {
        files: [
          expect.objectContaining({
            filename: undefined,
            mediaType: 'image/png',
            url: expect.stringMatching(/^data:image\/png;base64,/)
          })
        ],
        text: ''
      },
      expect.anything()
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pasted-image')
  })

  it('validates pasted files before adding them', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onError = vi.fn()
    let fileCount = 0

    const Probe = (): null => {
      fileCount = usePromptInputAttachments().files.length
      return null
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { maxFileSize: 1, onError, onSubmit: () => undefined },
          createElement(PromptInputTextarea),
          createElement(Probe)
        )
      )
    })

    const image = new File(['image'], 'image.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => image }] }
    })
    await act(async () => {
      container.querySelector('textarea')!.dispatchEvent(paste)
    })

    expect(fileCount).toBe(0)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'max_file_size' }))
  })

  it('accepts standard file-extension patterns', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:extension-image',
      revokeObjectURL: vi.fn()
    })
    let fileCount = 0

    const Probe = (): null => {
      fileCount = usePromptInputAttachments().files.length
      return null
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          PromptInput,
          { accept: '.png', onSubmit: () => undefined },
          createElement(PromptInputTextarea),
          createElement(Probe)
        )
      )
    })

    const image = new File(['image'], 'image.png')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => image }] }
    })
    await act(async () => {
      container.querySelector('textarea')!.dispatchEvent(paste)
    })

    expect(fileCount).toBe(1)
  })
})
