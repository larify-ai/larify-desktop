import { describe, expect, it, vi } from 'vitest'
import type { AssistantSessions } from '../../../src/renderer/src/app/interaction/assistant/sessions-context'
import { createWorkspaces } from '../../../src/renderer/src/app/navigation/workspaces'

function source(values: Partial<AssistantSessions> = {}): AssistantSessions {
  const session = {
    id: 'draft',
    heading: null,
    persisted: false,
    messages: [],
    hasMore: false
  }
  return {
    sessions: [session],
    directory: [],
    activeId: session.id,
    activeSession: session,
    create: vi.fn(),
    select: vi.fn(),
    loadMore: vi.fn(),
    refresh: vi.fn(),
    setPersisted: vi.fn(),
    setHeading: vi.fn(),
    ...values
  }
}

describe('createWorkspaces', () => {
  it('keeps the default workspace last without using a synthetic id', () => {
    const workspaces = createWorkspaces(
      source({
        directory: [
          { cwd: '', sessions: [], hasMore: false },
          { cwd: 'D:\\Workspace', sessions: [], hasMore: false }
        ]
      })
    )

    expect(workspaces.map(({ id }) => id)).toEqual(['D:\\Workspace', ''])
  })

  it('uses the stored session instead of a live session', () => {
    const live = {
      id: 'session',
      persisted: true,
      heading: { cwd: 'D:\\Workspace', title: 'Current title' }
    }
    const workspaces = createWorkspaces(
      source({
        sessions: [live],
        directory: [
          {
            cwd: 'D:\\Workspace',
            sessions: [{ id: 'session', title: 'Stored title', cwd: 'D:\\Workspace' }],
            hasMore: false
          }
        ],
        activeId: live.id,
        activeSession: live
      })
    )

    expect(workspaces[0].sessions).toHaveLength(1)
    expect(workspaces[0].sessions[0]).toMatchObject({
      id: 'session',
      name: 'Stored title'
    })
  })

  it('does not insert a live workspace missing from storage', () => {
    const live = {
      id: 'session',
      heading: { cwd: 'D:\\New', title: 'New session' },
      persisted: true
    }
    const workspaces = createWorkspaces(
      source({
        sessions: [live],
        directory: [{ cwd: '', sessions: [], hasMore: false }],
        activeId: live.id,
        activeSession: live
      })
    )

    expect(workspaces.map(({ id }) => id)).toEqual([''])
  })

  it('does not expose an unstarted draft', () => {
    const workspaces = createWorkspaces(
      source({ directory: [{ cwd: '', sessions: [], hasMore: false }] })
    )

    expect(workspaces[0].sessions).toEqual([])
  })

  it('does not expose live sessions before storage returns them', () => {
    const sessions = [
      { id: 'first', heading: { cwd: 'D:\\New', title: 'First' }, persisted: true },
      { id: 'second', heading: { cwd: 'D:\\New', title: 'Second' }, persisted: true }
    ]
    const workspaces = createWorkspaces(
      source({ sessions, activeId: 'second', activeSession: sessions[1] })
    )

    expect(workspaces).toEqual([])
  })

  it('keeps the database order without mutating the loaded directory', () => {
    const directory = [
      {
        cwd: 'D:\\Workspace',
        sessions: [
          { id: 'newest', title: 'Newest', cwd: 'D:\\Workspace' },
          { id: 'older', title: 'Older', cwd: 'D:\\Workspace' }
        ],
        hasMore: false
      }
    ]
    const snapshot = structuredClone(directory)

    const workspaces = createWorkspaces(
      source({
        directory,
        sessions: [
          {
            id: 'session',
            heading: { cwd: 'D:\\Workspace', title: 'Current title' },
            persisted: true
          }
        ]
      })
    )

    expect(workspaces[0].sessions.map(({ id }) => id)).toEqual(['newest', 'older'])
    expect(directory).toEqual(snapshot)
  })
})
