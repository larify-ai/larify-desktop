// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantSessionState } from '../../../src/renderer/src/app/interaction/assistant/sessions-context'

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  renders: new Map<string, number>(),
  props: new Map<
    string,
    {
      title?: string
      onHeadingChange: (heading: { cwd: string; title: string } | null) => void
      onSaved: () => Promise<void>
    }
  >()
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/sessions-context', () => ({
  useAssistantSessions: () => mocks.sessions()
}))
vi.mock('../../../src/renderer/src/app/interaction/assistant/session', () => ({
  AssistantSession: ({
    id,
    title,
    onHeadingChange,
    onSaved
  }: {
    id: string
    title?: string
    onHeadingChange: (heading: { cwd: string; title: string } | null) => void
    onSaved: () => Promise<void>
  }) => {
    mocks.renders.set(id, (mocks.renders.get(id) ?? 0) + 1)
    mocks.props.set(id, { title, onHeadingChange, onSaved })
    return createElement('span', null, id)
  }
}))

import { Interaction } from '../../../src/renderer/src/app/interaction/interaction'

const refresh = vi.fn()
const setPersisted = vi.fn()
const setHeading = vi.fn()

describe('Interaction', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    refresh.mockReset().mockResolvedValue(undefined)
    mocks.renders.clear()
    mocks.props.clear()
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('keeps sessions mounted without rerendering hidden sessions unnecessarily', async () => {
    const sessions = [session('first'), session('second'), session('third')]
    mockSessions(sessions, 'first')
    await render(0)

    mockSessions(sessions, 'first')
    await render(1)
    expect(Object.fromEntries(mocks.renders)).toEqual({ first: 1, second: 1, third: 1 })

    mockSessions(sessions, 'second')
    await render(2)
    expect(Object.fromEntries(mocks.renders)).toEqual({ first: 2, second: 2, third: 1 })
  })

  it('routes session events and exposes only the active session', async () => {
    const sessions = [
      session('first'),
      { ...session('second', true), heading: { cwd: 'D:\\workspace', title: 'Stored title' } }
    ]
    mockSessions(sessions, 'second')
    await render(0)

    const first = mocks.props.get('first')!
    const second = mocks.props.get('second')!
    const heading = { cwd: 'D:\\workspace', title: 'Title' }
    second.onHeadingChange(heading)
    await first.onSaved()
    await first.onSaved()
    await second.onSaved()

    expect(setHeading).toHaveBeenCalledWith('second', heading)
    expect(second.title).toBe('Stored title')
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(setPersisted).toHaveBeenCalledWith('first')
    expect(container.querySelector('section')?.textContent).toBe('firstsecond')
    expect(container.querySelector('span')?.parentElement?.className).toBe('hidden')
    expect(container.querySelectorAll('span')[1].parentElement?.className).toBe('h-full')
  })

  it('refreshes the directory for overlapping saves', async () => {
    const deferred = Promise.withResolvers<void>()
    refresh.mockReturnValue(deferred.promise)
    mockSessions([session('first')], 'first')
    await render(0)

    const saved = mocks.props.get('first')!.onSaved
    const first = saved()
    expect(setPersisted).toHaveBeenCalledWith('first')
    mockSessions(
      [{ ...session('first'), heading: { cwd: 'D:\\workspace', title: 'Updated' } }],
      'first'
    )
    await render(1)
    const second = mocks.props.get('first')!.onSaved()

    expect(refresh).toHaveBeenCalledTimes(2)
    deferred.resolve()
    await Promise.all([first, second])
    expect(setPersisted).toHaveBeenCalledOnce()
  })

  it('refreshes an existing session after every completed save', async () => {
    mockSessions([session('stored', true)], 'stored')
    await render(0)

    const saved = mocks.props.get('stored')!.onSaved
    await saved()
    await saved()

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(setPersisted).not.toHaveBeenCalled()
  })

  it('allows the first save refresh to be retried after failure', async () => {
    refresh.mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce(undefined)
    mockSessions([session('first')], 'first')
    await render(0)

    const saved = mocks.props.get('first')!.onSaved
    await expect(saved()).rejects.toThrow('refresh failed')
    expect(setPersisted).toHaveBeenCalledOnce()
    await saved()

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(setPersisted).toHaveBeenCalledOnce()
  })

  async function render(revision: number): Promise<void> {
    await act(async () => root.render(createElement(Harness, { revision })))
  }
})

function Harness({ revision }: { revision: number }): React.JSX.Element {
  void revision
  return createElement(Interaction)
}

function mockSessions(sessions: Array<{ id: string; persisted: boolean }>, activeId: string): void {
  mocks.sessions.mockReturnValue({ sessions, activeId, refresh, setPersisted, setHeading })
}

function session(id: string, persisted = false): AssistantSessionState {
  return { id, persisted, heading: null, messages: [], messageCount: 0 }
}
