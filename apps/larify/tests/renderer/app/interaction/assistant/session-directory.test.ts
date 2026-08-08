// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadSessionDirectory,
  loadSessionPage
} from '../../../../../src/renderer/src/app/interaction/assistant/session-directory'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { invoke }
  })
})

describe('loadSessionDirectory', () => {
  it('loads every workspace and keeps the default workspace last', async () => {
    invoke.mockImplementation((channel: string, cwd?: string) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Two', '', 'D:\\One'])
      return Promise.resolve([
        { id: `${cwd || 'default'}-id`, title: cwd || 'Default', cwd: cwd || 'default-path' }
      ])
    })

    await expect(loadSessionDirectory()).resolves.toEqual([
      {
        cwd: 'D:\\Two',
        hasMore: false,
        sessions: [{ id: 'D:\\Two-id', title: 'D:\\Two', cwd: 'D:\\Two' }]
      },
      {
        cwd: 'D:\\One',
        hasMore: false,
        sessions: [{ id: 'D:\\One-id', title: 'D:\\One', cwd: 'D:\\One' }]
      },
      {
        cwd: '',
        hasMore: false,
        sessions: [{ id: 'default-id', title: 'Default', cwd: 'default-path' }]
      }
    ])
  })

  it('ignores invalid workspace and session values', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'session:cwds'
          ? ['D:\\Workspace', null, 'D:\\Workspace']
          : [{ id: 'valid', title: 'Valid', cwd: 'D:\\Workspace' }, { id: 1 }]
      )
    )

    const directory = await loadSessionDirectory()

    expect(directory.map(({ cwd }) => cwd)).toEqual(['D:\\Workspace', ''])
    expect(directory[0].sessions).toEqual([{ id: 'valid', title: 'Valid', cwd: 'D:\\Workspace' }])
  })

  it('keeps other workspaces when one session list fails', async () => {
    invoke.mockImplementation((channel: string, cwd?: string) => {
      if (channel === 'session:cwds') return Promise.resolve(['D:\\Broken', 'D:\\Working'])
      if (cwd === 'D:\\Broken') return Promise.reject(new Error('Unavailable'))
      return Promise.resolve([{ id: 'valid', title: 'Valid', cwd: cwd || 'default' }])
    })

    await expect(loadSessionDirectory()).resolves.toEqual([
      { cwd: 'D:\\Broken', sessions: [], hasMore: false },
      {
        cwd: 'D:\\Working',
        hasMore: false,
        sessions: [{ id: 'valid', title: 'Valid', cwd: 'D:\\Working' }]
      },
      {
        cwd: '',
        sessions: [{ id: 'valid', title: 'Valid', cwd: 'default' }],
        hasMore: false
      }
    ])
  })

  it('still loads the default workspace when workspace discovery fails', async () => {
    invoke.mockImplementation((channel: string) =>
      channel === 'session:cwds'
        ? Promise.reject(new Error('Unavailable'))
        : Promise.resolve([{ id: 'default', title: 'Default', cwd: '' }])
    )

    await expect(loadSessionDirectory()).resolves.toEqual([
      {
        cwd: '',
        sessions: [{ id: 'default', title: 'Default', cwd: '' }],
        hasMore: false
      }
    ])
  })

  it('loads five sessions and uses the sixth only to detect another page', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'session:cwds'
          ? ['D:\\Workspace']
          : Array.from({ length: 6 }, (_, index) => ({
              id: String(index),
              title: `Session ${index}`,
              cwd: 'D:\\Workspace'
            }))
      )
    )

    const directory = await loadSessionDirectory()

    expect(directory[0].sessions).toHaveLength(5)
    expect(directory[0].hasMore).toBe(true)
    expect(invoke).toHaveBeenCalledWith('session:list', 'D:\\Workspace', 0, 6)
  })

  it('does not report another page when exactly five sessions remain', async () => {
    invoke.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        title: `Session ${index}`,
        cwd: 'D:\\Workspace'
      }))
    )

    const page = await loadSessionPage('D:\\Workspace', 10)

    expect(page.sessions).toHaveLength(5)
    expect(page.sessions[0].id).toBe('0')
    expect(page.hasMore).toBe(false)
    expect(invoke).toHaveBeenCalledWith('session:list', 'D:\\Workspace', 10, 6)
  })

  it('returns an empty page for invalid responses and preserves request failures', async () => {
    invoke.mockResolvedValueOnce({ sessions: [] }).mockRejectedValueOnce(new Error('Unavailable'))

    await expect(loadSessionPage('D:\\Invalid')).resolves.toEqual({
      sessions: [],
      hasMore: false
    })
    await expect(loadSessionPage('D:\\Broken')).rejects.toThrow('Unavailable')
  })
})
