import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const connectMcp = vi.fn(async () => {})
  const existsSync = vi.fn(() => true)
  const readdirSync = vi.fn(() => [])
  const readFileSync = vi.fn(() => '{}')
  const statSync = vi.fn(() => ({ mtimeMs: 100, size: 50 }))
  const larifyPath = vi.fn(() => '/fake/plugins')
  return { connectMcp, existsSync, readdirSync, readFileSync, statSync, larifyPath }
})

vi.mock('node:fs', () => ({
  existsSync: hoisted.existsSync,
  readdirSync: hoisted.readdirSync,
  readFileSync: hoisted.readFileSync,
  statSync: hoisted.statSync
}))
vi.mock('../../../../src/main/utils/app-paths', () => ({ larifyPath: hoisted.larifyPath }))
vi.mock('../../../../src/main/core/plugin/mcp', () => ({ connectMcp: hoisted.connectMcp }))

import { pluginDiscovery } from '../../../../src/main/core/plugin/plugin-discovery'
import type { PluginContext } from '../../../../src/main/core/plugin/protocol'

function dir(name: string) {
  return { name, isDirectory: () => true }
}

beforeEach(() => {
  hoisted.connectMcp.mockClear()
  hoisted.existsSync.mockReset().mockReturnValue(true)
  hoisted.readdirSync.mockReset().mockReturnValue([])
  hoisted.readFileSync.mockReset().mockReturnValue('{}')
  hoisted.statSync.mockReset().mockReturnValue({ mtimeMs: 100, size: 50 })
  hoisted.larifyPath.mockReset().mockReturnValue('/fake/plugins')
})

describe('FilesystemPluginDiscovery.discover', () => {
  it('returns [] when the plugins root does not exist', () => {
    hoisted.existsSync.mockReturnValue(false)

    expect(pluginDiscovery.discover()).toEqual([])
  })

  it('skips directories that have no plugin.json', () => {
    hoisted.existsSync.mockImplementation((p: string) => !p.endsWith('plugin.json'))
    hoisted.readdirSync.mockReturnValue([dir('nodirplugin')])

    expect(pluginDiscovery.discover()).toEqual([])
    expect(hoisted.readFileSync).not.toHaveBeenCalled()
  })

  it('builds a plugin from plugin.json and wires mcpServers on activate', () => {
    hoisted.readdirSync.mockReturnValue([dir('gh')])
    hoisted.readFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.2.3',
        description: 'a github plugin',
        mcpServers: { gh: { command: 'npx', args: ['-y', 'x'] } }
      })
    )

    const found = pluginDiscovery.discover()
    expect(found).toHaveLength(1)
    expect(found[0]!.fingerprint).toBe('100:50')
    expect(found[0]!.plugin.manifest).toEqual({
      id: 'gh',
      version: '1.2.3',
      description: 'a github plugin'
    })

    const ctx = {} as PluginContext
    found[0]!.plugin.activate(ctx)
    expect(hoisted.connectMcp).toHaveBeenCalledWith(ctx, { gh: { command: 'npx', args: ['-y', 'x'] } })
  })

  it('defaults version to 0.0.0 and drops a missing description', () => {
    hoisted.readdirSync.mockReturnValue([dir('bare')])
    hoisted.readFileSync.mockReturnValue(JSON.stringify({}))

    const found = pluginDiscovery.discover()
    expect(found[0]!.plugin.manifest).toEqual({ id: 'bare', version: '0.0.0', description: undefined })
  })

  it('skips a malformed plugin.json without throwing, loading the rest', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoisted.readdirSync.mockReturnValue([dir('bad'), dir('good')])
    hoisted.readFileSync.mockImplementation((p: string) =>
      p.includes('bad') ? '{not valid json' : JSON.stringify({ mcpServers: {} })
    )

    const found = pluginDiscovery.discover()

    expect(found).toHaveLength(1)
    expect(found[0]!.plugin.manifest.id).toBe('good')
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('skips non-directory entries (plain files) at the plugins root', () => {
    hoisted.readdirSync.mockReturnValue([
      { name: 'README.md', isDirectory: () => false },
      { name: 'gh', isDirectory: () => true }
    ])
    hoisted.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }))

    const found = pluginDiscovery.discover()
    expect(found).toHaveLength(1)
    expect(found[0]!.plugin.manifest.id).toBe('gh')
    expect(hoisted.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('does not produce duplicate plugins when a plugin dir contains a skills/ subdir', () => {
    hoisted.readdirSync.mockReturnValue([dir('gh')])
    hoisted.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }))

    const first = pluginDiscovery.discover()
    const second = pluginDiscovery.discover()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]!.plugin.manifest.id).toBe('gh')
    expect(second[0]!.plugin.manifest.id).toBe('gh')
    expect(first[0]!.fingerprint).toBe(second[0]!.fingerprint)
  })

  it('logs and skips a plugin when statSync on plugin.json throws (e.g. race delete)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoisted.readdirSync.mockReturnValue([dir('gone'), dir('good')])
    hoisted.statSync.mockImplementation((p: string) => {
      if (String(p).includes('gone')) throw new Error('ENOENT')
      return { mtimeMs: 100, size: 50 }
    })
    hoisted.readFileSync.mockImplementation((p: string) =>
      String(p).includes('gone')
        ? JSON.stringify({ version: '0.0.1' })
        : JSON.stringify({ version: '1.0.0' })
    )

    const found = pluginDiscovery.discover()
    expect(found).toHaveLength(1)
    expect(found[0]!.plugin.manifest.id).toBe('good')
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toContain('Failed to load plugin "gone"')
    spy.mockRestore()
  })
})
