// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMessagePage } from '../../../../../src/renderer/src/app/interaction/assistant/session-messages'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((channel: string, ...args: unknown[]) =>
    Promise.resolve(channel === 'attachment:load' ? args[0] : undefined)
  )
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { invoke }
  })
})

describe('loadMessagePage', () => {
  it('loads the latest 50 messages and detects an older page', async () => {
    invoke.mockImplementation((channel: string, ...args: unknown[]) =>
      Promise.resolve(
        channel === 'attachment:load'
          ? args[0]
          : Array.from({ length: 51 }, (_, index) => ({
              id: String(index),
              role: 'assistant',
              parts: []
            }))
      )
    )

    const page = await loadMessagePage('session', 10)

    expect(invoke).toHaveBeenCalledWith('session:msgs', 'session', 10, 51)
    expect(invoke).toHaveBeenCalledWith('attachment:load', expect.any(Array))
    expect(page.messages.map(({ id }) => id)).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index + 1))
    )
    expect(page.hasMore).toBe(true)
  })

  it('keeps a final partial page intact', async () => {
    invoke.mockImplementation((channel: string, ...args: unknown[]) =>
      Promise.resolve(
        channel === 'attachment:load' ? args[0] : [{ id: 'oldest', role: 'user', parts: [] }]
      )
    )

    await expect(loadMessagePage('session')).resolves.toEqual({
      messages: [{ id: 'oldest', role: 'user', parts: [] }],
      hasMore: false
    })
  })

  it('uses hydrated image URLs returned by the attachment service', async () => {
    const stored = {
      id: 'image',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: 'C:/attachments/image.png' }]
    }
    const hydrated = {
      ...stored,
      parts: [{ ...stored.parts[0], url: 'data:image/png;base64,aGVsbG8=' }]
    }
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'attachment:load' ? [hydrated] : [stored])
    )

    await expect(loadMessagePage('session')).resolves.toEqual({
      messages: [hydrated],
      hasMore: false
    })
  })

  it('treats an invalid response as an empty page', async () => {
    invoke.mockResolvedValue(undefined)

    await expect(loadMessagePage('session')).resolves.toEqual({ messages: [], hasMore: false })
  })
})
