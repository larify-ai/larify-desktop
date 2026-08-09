import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { Agent } from '../../../../src/main/core/agent/agent'
import { PluginHost } from '../../../../src/main/core/plugin'
import { Registry } from '../../../../src/main/infra/registry'
import { SessionStore } from '../../../../src/main/core/session'

describe.skipIf(!process.env.LIVE)('Agent live integration', () => {
  it('streams a real response and persists both messages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'larify-agent-live-'))
    const sessions = new SessionStore(join(directory, 'sessions.db'))
    const agent = new Agent(sessions, new PluginHost(new Registry()))
    const message: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: '只回复四个字：你好世界' }]
    }

    try {
      await new Promise<void>((resolve, reject) => {
        agent.send(
          { sessionId: 'live', cwd: directory, message },
          { chunk: () => undefined, error: reject, end: resolve }
        )
      })

      const stored = sessions.loadMessages('live')
      expect(stored.map(({ role }) => role)).toEqual(['user', 'assistant'])
      expect(stored[1].parts.length).toBeGreaterThan(0)
    } finally {
      agent.dispose()
      sessions.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
