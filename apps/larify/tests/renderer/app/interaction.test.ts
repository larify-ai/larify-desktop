// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  renders: new Map<string, number>(),
  props: new Map<
    string,
    {
      onHeadingChange: (heading: { cwd: string; title: string } | null) => void
      onSaved: () => void
    }
  >()
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/sessions-context', () => ({
  useAssistantSessions: () => mocks.sessions()
}))
vi.mock('../../../src/renderer/src/app/interaction/assistant/session', () => ({
  AssistantSession: ({
    id,
    onHeadingChange,
    onSaved
  }: {
    id: string
    onHeadingChange: (heading: { cwd: string; title: string } | null) => void
    onSaved: () => void
  }) => {
    mocks.renders.set(id, (mocks.renders.get(id) ?? 0) + 1)
    mocks.props.set(id, { onHeadingChange, onSaved })
    return createElement('span', null, id)
  }
}))

import { Interaction } from '../../../src/renderer/src/app/interaction/interaction'

const refresh = vi.fn()
const setHeading = vi.fn()

describe('Interaction', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
    const sessions = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
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
    const sessions = [{ id: 'first' }, { id: 'second' }]
    mockSessions(sessions, 'second')
    await render(0)

    const first = mocks.props.get('first')!
    const second = mocks.props.get('second')!
    const heading = { cwd: 'D:\\workspace', title: 'Title' }
    second.onHeadingChange(heading)
    first.onSaved()

    expect(setHeading).toHaveBeenCalledWith('second', heading)
    expect(refresh).toHaveBeenCalledOnce()
    expect(container.querySelector('section')?.textContent).toBe('firstsecond')
    expect(container.querySelector('span')?.parentElement?.className).toBe('hidden')
    expect(container.querySelectorAll('span')[1].parentElement?.className).toBe('h-full')
  })

  async function render(revision: number): Promise<void> {
    await act(async () => root.render(createElement(Harness, { revision })))
  }
})

function Harness({ revision }: { revision: number }): React.JSX.Element {
  void revision
  return createElement(Interaction)
}

function mockSessions(sessions: Array<{ id: string }>, activeId: string): void {
  mocks.sessions.mockReturnValue({ sessions, activeId, refresh, setHeading })
}
