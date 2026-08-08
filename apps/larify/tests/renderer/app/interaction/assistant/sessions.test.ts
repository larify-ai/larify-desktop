// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantSessionsProvider } from '../../../../../src/renderer/src/app/interaction/assistant/sessions'
import {
  useAssistantSessions,
  type AssistantSessions
} from '../../../../../src/renderer/src/app/interaction/assistant/sessions-context'

let root: Root
let sessions: AssistantSessions
const invoke = vi.fn()

function Probe(): null {
  const value = useAssistantSessions()
  useEffect(() => {
    sessions = value
  }, [value])
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
    expect(sessions.sessions).toEqual([{ id: sessions.activeId, heading: null }])
    expect(sessions.activeSession).toEqual(sessions.sessions[0])
  })

  it('reuses the existing draft', async () => {
    const id = sessions.activeId
    await act(async () => sessions.create())

    expect(sessions.activeId).toBe(id)
    expect(sessions.sessions).toHaveLength(1)
  })

  it('creates and selects a new draft after the current session starts', async () => {
    const previousId = sessions.activeId
    await act(async () => {
      sessions.setHeading(previousId, { cwd: 'D:\\Workspace', title: 'Started' })
      sessions.create()
    })

    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.activeId).not.toBe(previousId)
    expect(sessions.sessions.at(-1)?.heading).toBeNull()
  })

  it('selects an existing session', async () => {
    const previousId = sessions.activeId
    await act(async () => {
      sessions.setHeading(previousId, { cwd: 'D:\\Workspace', title: 'Started' })
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

  it('updates only the selected session heading', async () => {
    const firstId = sessions.activeId
    await act(async () => {
      sessions.setHeading(firstId, { cwd: 'D:\\One', title: 'First' })
      sessions.create()
    })
    const secondId = sessions.activeId
    await act(async () => {
      sessions.setHeading(secondId, { cwd: 'D:\\Two', title: 'Second' })
    })

    expect(sessions.sessions).toEqual([
      { id: firstId, heading: { cwd: 'D:\\One', title: 'First' } },
      { id: secondId, heading: { cwd: 'D:\\Two', title: 'Second' } }
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
