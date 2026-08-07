// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
          history: [],
          status: 'ready',
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

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    Reflect.deleteProperty(window, 'fs')
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

    await act(async () => render({ status: 'streaming', onSubmit }))
    await act(async () => render({ status: 'ready', onSubmit }))
    await act(async () => input('again'))
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
    await act(async () => submit())
    expect(onSubmit).not.toHaveBeenCalled()
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
