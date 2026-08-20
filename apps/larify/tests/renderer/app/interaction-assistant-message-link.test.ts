// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MessageLinkContextProvider } from '../../../src/renderer/src/app/interaction/assistant/message-links'
import { MessagePart } from '../../../src/renderer/src/app/interaction/assistant/message-parts/message-part'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('renders and opens a file link through the real markdown renderer', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const handler = vi.fn()

  await act(async () => {
    root.render(
      createElement(
        MessageLinkContextProvider,
        { value: handler },
        createElement(MessagePart, {
          part: {
            type: 'text',
            text: [
              '[relative](readme.md)',
              '[file](file:///D:/readme.md)',
              '[windows](D:/Workspace/readme.md)',
              '[url](https://example.com)',
              '[unsafe](javascript:alert(1))',
              '[data](data:text/html,unsafe)',
              '![remote](https://example.com/image.png)',
              '![inline](data:image/png;base64,aW1hZ2U=)',
              '![unsafe-image](data:text/html,unsafe)',
              '![uppercase-unsafe-image](DATA:text/html,unsafe)'
            ].join('\n\n')
          },
          streaming: false
        })
      )
    )
  })

  await vi.waitFor(() => {
    expect(container.querySelector('a'), container.innerHTML).not.toBeNull()
  })
  const links = [...container.querySelectorAll<HTMLElement>('.larify-message-link')]
  const link = links.find(({ textContent }) => textContent === 'relative')
  expect(link?.tagName).toBe('BUTTON')
  expect(link?.getAttribute('type')).toBe('button')
  expect(link?.hasAttribute('node')).toBe(false)
  expect(links.find(({ textContent }) => textContent === 'file')?.tagName).toBe('BUTTON')
  expect(links.find(({ textContent }) => textContent === 'windows')?.tagName).toBe('BUTTON')
  expect(links.find(({ textContent }) => textContent === 'url')?.getAttribute('href')).toBe(
    'https://example.com'
  )
  expect(links.find(({ textContent }) => textContent === 'url')?.tagName).toBe('A')
  expect(links.find(({ textContent }) => textContent === 'unsafe')?.hasAttribute('href')).toBe(
    false
  )
  expect(links.find(({ textContent }) => textContent === 'data')?.hasAttribute('href')).toBe(false)
  expect(container.querySelector<HTMLImageElement>('img[alt="remote"]')?.src).toBe(
    'https://example.com/image.png'
  )
  expect(container.querySelector<HTMLImageElement>('img[alt="inline"]')?.getAttribute('src')).toBe(
    'data:image/png;base64,aW1hZ2U='
  )
  expect(
    container.querySelector<HTMLImageElement>('img[alt="unsafe-image"]')?.hasAttribute('src') ??
      false
  ).toBe(false)
  expect(
    container
      .querySelector<HTMLImageElement>('img[alt="uppercase-unsafe-image"]')
      ?.hasAttribute('src') ?? false
  ).toBe(false)

  await act(async () => {
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  expect(handler).toHaveBeenCalledExactlyOnceWith({ kind: 'file', target: 'readme.md' })

  await act(async () => root.unmount())
  container.remove()
})
