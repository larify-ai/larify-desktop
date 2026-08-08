// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  loadMessagePage,
  loadVisibleMessages
} from '../../../../../src/renderer/src/app/interaction/assistant/session-messages'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { invoke }
  })
})

describe('session messages', () => {
  it('loads and hydrates the latest message page', async () => {
    const stored = messages(50, 50)
    const hydrated = messages(50, 100)
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'session:msg-count') return Promise.resolve(100)
      if (channel === 'session:msgs') return Promise.resolve(stored)
      if (channel === 'attachment:load') return Promise.resolve(hydrated)
      return Promise.resolve(args[0])
    })

    await expect(loadMessagePage('session')).resolves.toEqual({
      messages: hydrated,
      messageCount: 100
    })
    expect(invoke).toHaveBeenCalledWith('session:msg-count', 'session')
    expect(invoke).toHaveBeenCalledWith('session:msgs', 'session', 50, 50)
  })

  it('loads an absolute visible range directly', async () => {
    const stored = messages(50, 100)
    invoke.mockImplementation((channel: string, ...args: unknown[]) =>
      Promise.resolve(channel === 'attachment:load' ? args[0] : stored)
    )

    await expect(loadVisibleMessages('session', 100, 50)).resolves.toEqual(stored)
    expect(invoke).toHaveBeenCalledWith('session:msgs', 'session', 100, 50)
  })

  it('hydrates attachments in a loaded page', async () => {
    const stored = messages(1)
    const hydrated = [{ ...stored[0], parts: [{ type: 'text' as const, text: 'hydrated' }] }]
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'attachment:load' ? hydrated : stored)
    )

    await expect(loadVisibleMessages('session', 0, 1)).resolves.toEqual(hydrated)
  })

  it('does not load a message range for an empty session', async () => {
    invoke.mockResolvedValue(0)

    await expect(loadMessagePage('session')).resolves.toEqual({
      messages: [],
      messageCount: 0
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, -1, 1.5, Number.NaN])(
    'treats an invalid count (%s) as an empty session',
    async (count) => {
      invoke.mockImplementation((channel: string) =>
        Promise.resolve(channel === 'session:msg-count' ? count : undefined)
      )

      await expect(loadMessagePage('session')).resolves.toEqual({
        messages: [],
        messageCount: 0
      })
      expect(invoke).toHaveBeenCalledTimes(1)
    }
  )

  it('falls back to stored messages when attachment hydration is invalid', async () => {
    const stored = messages(1)
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'attachment:load' ? undefined : stored)
    )

    await expect(loadVisibleMessages('session', 0, 1)).resolves.toEqual(stored)
  })

  it('falls back to stored messages when attachment hydration fails', async () => {
    const stored = messages(1)
    invoke.mockImplementation((channel: string) => {
      if (channel === 'attachment:load') return Promise.reject(new Error('Unavailable'))
      return Promise.resolve(stored)
    })

    await expect(loadVisibleMessages('session', 0, 1)).resolves.toEqual(stored)
  })
})

function messages(count: number, start = 0): UIMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(start + index),
    role: 'assistant' as const,
    parts: []
  }))
}
