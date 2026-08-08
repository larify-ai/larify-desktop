// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantSessionsProvider } from '../../../../../src/renderer/src/app/interaction/assistant/sessions'
import {
  useAssistantSessions,
  type AssistantSessions
} from '../../../../../src/renderer/src/app/interaction/assistant/sessions-context'

let root: Root
let sessions: AssistantSessions

function Probe(): null {
  const value = useAssistantSessions()
  useEffect(() => {
    sessions = value
  }, [value])
  return null
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
})
