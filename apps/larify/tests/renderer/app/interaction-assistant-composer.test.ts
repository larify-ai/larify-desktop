// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantComposer } from '../../../src/renderer/src/app/interaction/assistant/composer'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('AssistantComposer', () => {
  let container: HTMLDivElement
  let root: Root

  const render = (props: Partial<Parameters<typeof AssistantComposer>[0]> = {}): void => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(AssistantComposer, {
          cwd: '',
          history: [],
          status: 'ready',
          showWorkspace: true,
          onCwdChange: vi.fn(),
          onSubmit: vi.fn(),
          onStop: vi.fn(),
          ...props
        })
      )
    )
  }

  const input = (value: string): void => {
    const textarea = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      value
    )
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const submit = (): void => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke: vi.fn().mockResolvedValue([]) }
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    Reflect.deleteProperty(window, 'bridge')
    Reflect.deleteProperty(window, 'fs')
    vi.unstubAllGlobals()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('submits trimmed text once until the status changes', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onSubmit = vi.fn()

    await act(async () => render({ onSubmit }))
    await act(async () => input('  hello  '))
    await act(async () => {
      submit()
      submit()
    })

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', files: [] })
    expect(container.querySelector('textarea')!.value).toBe('')

    await act(async () => render({ status: 'error', onSubmit }))
    await act(async () => input('again'))
    const inputGroup = container.querySelector('[data-slot="input-group"]')
    expect(inputGroup?.className).toContain('border-input')
    expect(inputGroup?.parentElement?.className).toContain('rounded-2xl')
    expect(inputGroup?.parentElement?.className).not.toContain('border-0')
    await act(async () => submit())
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('does not submit empty input', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onSubmit = vi.fn()
    await act(async () => render({ onSubmit }))
    expect(container.querySelector('textarea')!.placeholder).toBe('描述任务...')
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.querySelector('.lucide-arrow-up')).not.toBeNull()
    const attachment = container.querySelector('.lucide-plus')?.closest('button')
    expect(attachment?.getAttribute('style')).toContain('border-radius: 9999px')
    expect(attachment?.classList.contains('text-secondary-foreground')).toBe(true)
    expect(attachment?.classList.contains('bg-secondary')).toBe(true)
    expect(attachment?.getAttribute('aria-label')).toBe('添加附件')
    expect(button.classList.contains('disabled:opacity-50')).toBe(true)
    const composer = container.querySelector('.mx-auto')
    expect(composer?.hasAttribute('data-composer-layout-shell')).toBe(true)
    expect(composer?.className).toContain('max-w-4xl')
    expect(composer?.className).toContain('-mt-4')
    expect(composer?.className).toContain('w-full')
    expect(composer?.className).not.toContain('translate-x-')
    expect(composer?.firstElementChild?.className).toContain('z-10')
    expect(container.textContent).toContain('默认空间')
    const workspaceButton = container.querySelector('button[title="默认空间"]')
    expect(workspaceButton?.parentElement?.parentElement?.className).toContain('rounded-2xl')
    expect(workspaceButton?.parentElement?.parentElement?.className).toContain('overflow-hidden')
    expect(container.querySelector('[data-slot="input-group"]')?.textContent).not.toContain(
      '默认空间'
    )
    expect(container.querySelector('[aria-label="配置模型和思考强度"]')?.textContent).toContain(
      'DeepSeek-V4-Flash-Vision低'
    )
    await act(async () => submit())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('selects and persists the model and official reasoning effort', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => render())

    const open = async (): Promise<void> => {
      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="配置模型和思考强度"]'
      )!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
        )
      })
    }
    const select = async (label: string): Promise<void> => {
      const option = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === label
      )!
      await act(async () => option.click())
    }

    await open()
    await select('DeepSeek-V4-Pro')
    await open()
    const max = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        button.textContent === '高' && button.closest('[data-slot="dropdown-menu-content"]')
    )!
    await act(async () => max.click())
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull()

    expect(localStorage.getItem('larify.modelConfig')).toBe(
      '{"modelId":"deepseek-v4-pro","reasoningEffort":"max"}'
    )
    expect(container.querySelector('[aria-label="配置模型和思考强度"]')?.textContent).toContain(
      'DeepSeek-V4-Pro高'
    )

    await act(async () => render({ status: 'streaming' }))
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="配置模型和思考强度"]')?.disabled
    ).toBe(true)
  })

  it('keeps the attachment menu open while selecting a directory', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const invoke = vi.fn().mockResolvedValue(['C:\\workspace'])
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke }
    })

    await act(async () => render())
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="添加附件"]')!
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
      )
    })
    const directory = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === '目录'
    )!
    await act(async () => directory.click())

    expect(invoke).toHaveBeenCalledWith('dialog:pick-directories')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('measures the attachment menu only while it is open', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const observers: Array<{
      disconnect: ReturnType<typeof vi.fn>
      observe: ReturnType<typeof vi.fn>
    }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()

        constructor() {
          observers.push(this)
        }
      }
    )

    await act(async () => render())
    expect(observers.every(({ observe }) => !observe.mock.calls.length)).toBe(true)

    const trigger = container.querySelector<SVGElement>('.lucide-plus')!.closest('button')!
    const input = container.querySelector<HTMLElement>('.relative.z-10')!
    input.getBoundingClientRect = () => ({
      bottom: 500,
      height: 160,
      left: 100,
      right: 740,
      top: 340,
      width: 640,
      x: 100,
      y: 340,
      toJSON: () => ({})
    })
    trigger.parentElement!.getBoundingClientRect = () => ({
      bottom: 480,
      height: 32,
      left: 112,
      right: 144,
      top: 448,
      width: 32,
      x: 112,
      y: 448,
      toJSON: () => ({})
    })

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
      )
    })

    const inputObserver = observers.find(({ observe }) =>
      observe.mock.calls.some(([element]) => element === input)
    )
    expect(inputObserver).toBeDefined()
    expect(document.querySelector<HTMLElement>('[role="menu"]')?.style.width).toBe('640px')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })
    expect(inputObserver?.disconnect).toHaveBeenCalledOnce()
  })

  it('hides the workspace selector after the conversation starts', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => render({ showWorkspace: false }))

    expect(container.textContent).not.toContain('默认空间')
  })

  it('stops a streaming response only once', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onStop = vi.fn()

    await act(async () => render({ status: 'streaming', onStop }))
    const button = container.querySelector('button[aria-label="停止"]') as HTMLButtonElement
    await act(async () => {
      button.click()
      button.click()
    })
    expect(onStop).toHaveBeenCalledOnce()

    await act(async () => render({ status: 'ready', onStop }))
    await act(async () => render({ status: 'streaming', onStop }))
    await act(async () => {
      ;(container.querySelector('button[aria-label="停止"]') as HTMLButtonElement).click()
    })
    expect(onStop).toHaveBeenCalledTimes(2)
  })

  it('submits an attachment without text', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onSubmit = vi.fn()
    Object.defineProperty(window, 'fs', {
      configurable: true,
      value: { getPathForFile: () => 'C:\\note.txt' }
    })

    await act(async () => render({ onSubmit }))
    const file = new File(['content'], 'note.txt', { type: 'text/plain' })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [file], items: [], types: ['Files'] }
    })
    await act(async () => container.querySelector('form')!.dispatchEvent(drop))

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await act(async () => submit())
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0].text).toBe('')
    expect(onSubmit.mock.calls[0][0].files[0]).toMatchObject({
      filename: 'note.txt',
      mediaType: 'text/plain'
    })
  })
})
