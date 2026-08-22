// @vitest-environment jsdom

import { act, createElement, StrictMode, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantSessionsProvider } from '../../../../../src/renderer/src/app/interaction/assistant/sessions'
import {
  useAssistantSessions,
  type AssistantSessions
} from '../../../../../src/renderer/src/app/interaction/assistant/sessions-context'
import {
  useSessionAttentionReport,
  type SessionAttentionReport
} from '../../../../../src/renderer/src/app/interaction/assistant/session-attention'

let root: Root
let sessions: AssistantSessions
let reportAttentionState: SessionAttentionReport
const invoke = vi.fn()

function Probe(): null {
  const value = useAssistantSessions()
  const report = useSessionAttentionReport()
  useEffect(() => {
    sessions = value
    reportAttentionState = report
  }, [report, value])
  return null
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  invoke.mockReset()
  invoke.mockResolvedValue([])
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { invoke }
  })
  root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
  })
})

afterEach(() => {
  act(() => root.unmount())
})

describe('AssistantSessionsProvider', () => {
  it('starts with one active draft', () => {
    expect(sessions.sessions).toEqual([
      {
        cwd: '',
        id: sessions.activeId,
        heading: null,
        persisted: false,
        messages: [],
        messageCount: 0
      }
    ])
    expect(sessions.activeSession).toEqual(sessions.sessions[0])
  })

  it('reuses the existing draft and closes its resources', async () => {
    const id = sessions.activeId
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'resource:list' ? [{ id: 7 }] : undefined)
    )
    await act(async () => sessions.create())

    expect(sessions.activeId).toBe(id)
    expect(sessions.sessions).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('resource:list', { sessionId: id })
    expect(invoke).toHaveBeenCalledWith('resource:close', 7)
  })

  it('creates a draft in the requested workspace', async () => {
    const firstId = sessions.activeId
    await act(async () => {
      sessions.create('D:\\Workspace')
    })
    expect(sessions.activeSession).toMatchObject({ id: firstId, cwd: 'D:\\Workspace' })

    await act(async () => {
      sessions.setPersisted(firstId)
      sessions.create('D:\\Another')
    })
    expect(sessions.activeSession).toMatchObject({ cwd: 'D:\\Another', persisted: false })
  })

  it.each(['active', 'waiting'] as const)(
    'marks a background %s session unread when it settles and clears it on select',
    async (runtimeState) => {
      const backgroundId = sessions.activeId
      await act(async () => {
        sessions.setPersisted(backgroundId)
        sessions.create()
        reportAttentionState(backgroundId, runtimeState)
        reportAttentionState(backgroundId, 'idle')
      })

      expect(sessions.attentionState(backgroundId)).toBe('unread')

      await act(async () => reportAttentionState(backgroundId, 'idle'))
      expect(sessions.attentionState(backgroundId)).toBe('unread')

      await act(async () => sessions.select(backgroundId))
      expect(sessions.attentionState(backgroundId)).toBe('idle')
    }
  )

  it('keeps the current session active or waiting without creating unread state', async () => {
    const id = sessions.activeId

    await act(async () => reportAttentionState(id, 'active'))
    expect(sessions.attentionState(id)).toBe('active')

    await act(async () => reportAttentionState(id, 'waiting'))
    expect(sessions.attentionState(id)).toBe('waiting')

    await act(async () => reportAttentionState(id, 'idle'))
    expect(sessions.attentionState(id)).toBe('idle')
  })

  it('does not change the selected session for an unknown id', async () => {
    const id = sessions.activeId
    await act(async () => sessions.select('missing'))
    expect(sessions.activeId).toBe(id)
  })

  it('closes draft resources only once when Strict Mode replays the update', async () => {
    act(() => root.unmount())
    root = createRoot(document.createElement('div'))
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'resource:list' ? [{ id: 7 }] : undefined)
    )
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(AssistantSessionsProvider, null, createElement(Probe))
        )
      )
    })

    await act(async () => sessions.create())

    expect(invoke.mock.calls.filter(([channel]) => channel === 'resource:list')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'resource:close')).toHaveLength(1)
  })

  it('allows resource cleanup to retry after a failure', async () => {
    let attempts = 0
    invoke.mockImplementation((channel: string) => {
      if (channel !== 'resource:list') return Promise.resolve(undefined)
      attempts += 1
      return attempts === 1
        ? Promise.reject(new Error('unavailable'))
        : Promise.resolve([{ id: 7 }])
    })

    await act(async () => sessions.create())
    await act(async () => sessions.create())

    expect(invoke.mock.calls.filter(([channel]) => channel === 'resource:list')).toHaveLength(2)
    expect(invoke).toHaveBeenCalledWith('resource:close', 7)
  })

  it('creates and selects a new draft after the current session starts', async () => {
    const previousId = sessions.activeId
    await act(async () => {
      sessions.setPersisted(previousId)
      sessions.create()
    })

    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.activeId).not.toBe(previousId)
    expect(sessions.sessions.at(-1)?.heading).toBeNull()
  })

  it('selects an existing session', async () => {
    const previousId = sessions.activeId
    await act(async () => {
      sessions.setPersisted(previousId)
      sessions.create()
    })
    await act(async () => sessions.select(previousId))

    expect(sessions.activeId).toBe(previousId)
  })

  it('ignores an unknown session id', async () => {
    const activeId = sessions.activeId

    await act(async () => sessions.select('missing'))

    expect(sessions.activeId).toBe(activeId)
    expect(sessions.activeSession.id).toBe(activeId)
  })

  it('opens a stored session with its latest messages', async () => {
    act(() => root.unmount())
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (channel === 'session:list') {
        return Promise.resolve([{ id: 'stored', title: 'Stored', cwd: 'D:\\Workspace' }])
      }
      if (channel === 'session:msgs') {
        return Promise.resolve([{ id: 'message', role: 'user', parts: [] }])
      }
      if (channel === 'session:msg-count') return Promise.resolve(1)
      if (channel === 'attachment:load') return Promise.resolve(args[0])
      return Promise.resolve([])
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })
    await act(async () => {
      reportAttentionState('stored', 'active')
      reportAttentionState('stored', 'idle')
    })
    expect(sessions.attentionState('stored')).toBe('unread')

    await act(async () => sessions.select('stored'))

    expect(sessions.activeId).toBe('stored')
    expect(sessions.attentionState('stored')).toBe('idle')
    expect(sessions.activeSession).toMatchObject({
      id: 'stored',
      heading: { cwd: 'D:\\Workspace', title: 'Stored' },
      persisted: true,
      messages: [{ id: 'message', role: 'user', parts: [] }],
      messageCount: 1
    })
  })

  it('keeps a stored session unread when opening its messages fails', async () => {
    act(() => root.unmount())
    invoke.mockImplementation((channel: string) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (channel === 'session:list') {
        return Promise.resolve([{ id: 'stored', title: 'Stored', cwd: 'D:\\Workspace' }])
      }
      if (channel === 'session:msg-count') return Promise.reject(new Error('load failed'))
      return Promise.resolve([])
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })
    const activeId = sessions.activeId
    await act(async () => {
      reportAttentionState('stored', 'active')
      reportAttentionState('stored', 'idle')
    })

    await act(async () => sessions.select('stored'))

    expect(sessions.activeId).toBe(activeId)
    expect(sessions.attentionState('stored')).toBe('unread')
    await act(async () => {
      reportAttentionState(activeId, 'active')
      reportAttentionState(activeId, 'idle')
    })
    expect(sessions.attentionState(activeId)).toBe('idle')
  })

  it('keeps a new draft selected when an older open request finishes later', async () => {
    act(() => root.unmount())
    let resolveMessages!: (value: unknown[]) => void
    const messages = new Promise<unknown[]>((resolve) => {
      resolveMessages = resolve
    })
    invoke.mockImplementation((channel: string) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (channel === 'session:list') {
        return Promise.resolve([{ id: 'stored', title: 'Stored', cwd: 'D:\\Workspace' }])
      }
      if (channel === 'session:msg-count') return Promise.resolve(1)
      if (channel === 'session:msgs') return messages
      return Promise.resolve([])
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })
    const draft = sessions.activeId
    await act(async () => {
      reportAttentionState('stored', 'active')
      reportAttentionState('stored', 'idle')
    })

    let opening!: Promise<void>
    act(() => {
      opening = sessions.select('stored')
      sessions.create()
    })
    resolveMessages([])
    await act(async () => opening)

    expect(sessions.activeId).toBe(draft)
    expect(sessions.sessions.some(({ id }) => id === 'stored')).toBe(true)
    expect(sessions.attentionState('stored')).toBe('unread')
  })

  it('updates only the selected session heading', async () => {
    const firstId = sessions.activeId
    await act(async () => {
      sessions.setHeading(firstId, { cwd: 'D:\\One', title: 'First' })
      sessions.setPersisted(firstId)
      sessions.create()
    })
    const secondId = sessions.activeId
    await act(async () => {
      sessions.setHeading(secondId, { cwd: 'D:\\Two', title: 'Second' })
    })

    expect(sessions.sessions).toEqual([
      {
        cwd: 'D:\\One',
        id: firstId,
        heading: { cwd: 'D:\\One', title: 'First' },
        persisted: true,
        messages: [],
        messageCount: 0
      },
      {
        cwd: 'D:\\Two',
        id: secondId,
        heading: { cwd: 'D:\\Two', title: 'Second' },
        persisted: false,
        messages: [],
        messageCount: 0
      }
    ])
  })

  it('loads and merges the next workspace page', async () => {
    act(() => root.unmount())
    invoke.mockImplementation((channel: string, cwd?: string, offset = 0) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (!cwd) return Promise.resolve([])
      const count = offset === 0 ? 6 : 3
      return Promise.resolve(
        Array.from({ length: count }, (_, index) => {
          const position = offset + index
          return { id: String(position), title: `Session ${position}`, cwd }
        })
      )
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    expect(sessions.directory[0].sessions).toHaveLength(5)
    expect(sessions.directory[0].hasMore).toBe(true)

    await act(async () => sessions.loadMore('D:\\Workspace'))

    expect(sessions.directory[0].sessions).toHaveLength(8)
    expect(sessions.directory[0].hasMore).toBe(false)
    expect(invoke).toHaveBeenCalledWith('session:list', 'D:\\Workspace', 5, 6)
  })

  it('keeps the next page available after a temporary failure', async () => {
    act(() => root.unmount())
    invoke.mockImplementation((channel: string, cwd?: string, offset = 0) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (offset > 0) return Promise.reject(new Error('Unavailable'))
      return Promise.resolve(
        Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          title: `Session ${index}`,
          cwd
        }))
      )
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    await act(async () => sessions.loadMore('D:\\Workspace'))

    expect(sessions.directory[0].sessions).toHaveLength(5)
    expect(sessions.directory[0].hasMore).toBe(true)
  })

  it('does not load the same page concurrently', async () => {
    act(() => root.unmount())
    let resolvePage!: (value: unknown[]) => void
    const page = new Promise<unknown[]>((resolve) => {
      resolvePage = resolve
    })
    invoke.mockImplementation((channel: string, cwd?: string, offset = 0) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (offset > 0) return page
      return Promise.resolve(
        Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          title: `Session ${index}`,
          cwd
        }))
      )
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = sessions.loadMore('D:\\Workspace')
      second = sessions.loadMore('D:\\Workspace')
    })
    expect(invoke.mock.calls.filter(([, , offset]) => offset === 5)).toHaveLength(1)

    resolvePage([])
    await act(async () => Promise.all([first, second]))
  })

  it('ignores an old page after the directory refreshes', async () => {
    act(() => root.unmount())
    let resolvePage!: (value: unknown[]) => void
    const page = new Promise<unknown[]>((resolve) => {
      resolvePage = resolve
    })
    invoke.mockImplementation((channel: string, cwd?: string, offset = 0) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      if (offset > 0) return page
      return Promise.resolve(
        Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          title: `Session ${index}`,
          cwd
        }))
      )
    })
    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
    })

    let load!: Promise<void>
    act(() => {
      load = sessions.loadMore('D:\\Workspace')
    })
    invoke.mockImplementation((channel: string, cwd?: string) =>
      Promise.resolve(
        channel === 'session:cwds' ? ['D:\\Workspace'] : [{ id: 'new', title: 'New', cwd }]
      )
    )
    await act(async () => sessions.refresh())
    resolvePage([{ id: 'old', title: 'Old', cwd: 'D:\\Workspace' }])
    await act(async () => load)

    expect(sessions.directory[0].sessions.map(({ id }) => id)).toEqual(['new'])
  })

  it('refreshes the directory from storage', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Workspace'])
      return Promise.resolve([
        { id: 'newest', title: 'Newest', cwd: 'D:\\Workspace' },
        { id: 'older', title: 'Older', cwd: 'D:\\Workspace' }
      ])
    })

    await act(async () => sessions.refresh())

    expect(sessions.directory[0].sessions.map(({ id }) => id)).toEqual(['newest', 'older'])
  })

  it('recovers after the initial directory load fails', async () => {
    act(() => root.unmount())
    invoke
      .mockImplementationOnce(() => {
        throw new Error('Unavailable')
      })
      .mockImplementation((channel: string, cwd?: string) =>
        Promise.resolve(
          channel === 'session:cwds' ? ['D:\\Workspace'] : [{ id: 'stored', title: 'Stored', cwd }]
        )
      )
    root = createRoot(document.createElement('div'))

    await act(async () => {
      root.render(createElement(AssistantSessionsProvider, null, createElement(Probe)))
      await Promise.resolve()
    })
    await act(async () => sessions.refresh())

    expect(sessions.directory[0].sessions.map(({ id }) => id)).toEqual(['stored'])
  })

  it('does not let an older refresh overwrite a newer one', async () => {
    let resolveOlder!: (value: string[]) => void
    let resolveNewer!: (value: string[]) => void
    const older = new Promise<string[]>((resolve) => {
      resolveOlder = resolve
    })
    const newer = new Promise<string[]>((resolve) => {
      resolveNewer = resolve
    })
    let calls = 0
    invoke.mockImplementation((channel: string, cwd?: string) => {
      if (channel === 'session:cwds') return ++calls === 1 ? older : newer
      return Promise.resolve([{ id: cwd, title: cwd, cwd }])
    })

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = sessions.refresh()
      second = sessions.refresh()
    })
    resolveNewer(['newer'])
    await act(async () => second)
    resolveOlder(['older'])
    await act(async () => first)

    expect(sessions.directory.map(({ cwd }) => cwd)).toEqual(['newer', ''])
  })
})
