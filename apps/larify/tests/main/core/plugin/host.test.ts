import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineService, Registry } from '../../../../src/shared/infra/registry'
import {
  defineTool,
  FilesystemSkillDiscovery,
  PluginHost,
  type Plugin,
  type Tool
} from '../../../../src/main/core/plugin'

const tool = (description: string): Tool =>
  defineTool({ description, inputSchema: z.object({}), execute: () => undefined })

describe('PluginHost', () => {
  it('activates a plugin and collects its contributions', async () => {
    const registry = new Registry()
    const token = defineService()
    const testTool = tool('test tool')
    registry.register(token, { application: true })
    const plugin: Plugin = {
      manifest: { id: 'test', displayName: 'Test' },
      activate(context) {
        expect(context.manifest).toBe(this.manifest)
        expect(context.registry.get(token)).toEqual({ application: true })
        context.registerTool('run', testTool)
      }
    }
    const host = new PluginHost(registry)

    await host.activate(plugin)

    expect(host.listPlugins()).toEqual([{ id: 'test', displayName: 'Test' }])
    expect(host.getTools('test')?.get('test_run')?.description).toBe('test tool')
  })

  it('discovers skills under the activated plugin and lets user skills override bundled ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const bundled = join(root, 'bundled', 'plugins', 'browser', 'skills', 'research')
    const user = join(root, 'user', 'plugins', 'browser', 'skills', 'research')
    try {
      mkdirSync(bundled, { recursive: true })
      mkdirSync(user, { recursive: true })
      writeFileSync(
        join(bundled, 'SKILL.md'),
        '---\nname: research\ndescription: Bundled research\neager: true\n---\n'
      )
      writeFileSync(
        join(user, 'SKILL.md'),
        '---\nname: research\ndescription: User research\n---\n'
      )
      const host = new PluginHost(
        new Registry(),
        new FilesystemSkillDiscovery(() => [
          join(root, 'bundled', 'plugins', 'browser', 'skills'),
          join(root, 'user', 'plugins', 'browser', 'skills')
        ])
      )

      await host.activate({ manifest: { id: 'browser' }, activate: () => undefined })
      host.refreshSkills()

      expect(host.getSkills('browser')?.get('browser_research')).toMatchObject({
        path: join(user, 'SKILL.md'),
        description: 'User research'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lets an identical user skill override the bundled file path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const bundled = join(root, 'bundled', 'same')
    const user = join(root, 'user', 'same')
    const source = '---\nname: same\ndescription: Same content\n---\n'
    try {
      mkdirSync(bundled, { recursive: true })
      mkdirSync(user, { recursive: true })
      writeFileSync(join(bundled, 'SKILL.md'), source)
      writeFileSync(join(user, 'SKILL.md'), source)
      const host = new PluginHost(
        new Registry(),
        new FilesystemSkillDiscovery(() => [join(root, 'bundled'), join(root, 'user')])
      )
      await host.activate({ manifest: { id: 'agent' }, activate: () => undefined })

      host.refreshSkills()

      expect(host.getSkills('agent')?.get('agent_same')?.path).toBe(join(user, 'SKILL.md'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a plugin active when one discovered skill is invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const skills = join(root, 'plugins', 'browser', 'skills')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      mkdirSync(join(skills, 'valid'), { recursive: true })
      mkdirSync(join(skills, 'invalid'), { recursive: true })
      writeFileSync(
        join(skills, 'valid', 'SKILL.md'),
        '---\nname: valid\ndescription: Valid\n---\n'
      )
      writeFileSync(join(skills, 'invalid', 'SKILL.md'), '# missing frontmatter')
      const host = new PluginHost(new Registry(), new FilesystemSkillDiscovery(() => [skills]))

      await host.activate({ manifest: { id: 'browser' }, activate: () => undefined })
      host.refreshSkills()

      expect(host.has('browser')).toBe(true)
      expect(host.getSkills('browser')?.get('browser_valid')).toMatchObject({
        description: 'Valid'
      })
      expect(warning).toHaveBeenCalledOnce()
    } finally {
      warning.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a skill with unclosed frontmatter without disabling its plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const skillDirectory = join(root, 'unclosed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      mkdirSync(skillDirectory, { recursive: true })
      writeFileSync(
        join(skillDirectory, 'SKILL.md'),
        '---\nname: unclosed\ndescription: Missing closing delimiter\n'
      )
      const host = new PluginHost(new Registry(), new FilesystemSkillDiscovery(() => [root]))
      await host.activate({ manifest: { id: 'agent' }, activate: () => undefined })

      host.refreshSkills()

      expect(host.has('agent')).toBe(true)
      expect(host.getSkills('agent')).toEqual(new Map())
      expect(warning).toHaveBeenCalledOnce()
    } finally {
      warning.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a plugin active when a skill directory is unreadable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const unreadable = join(root, 'not-a-directory')
    const valid = join(root, 'valid')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      writeFileSync(unreadable, '')
      mkdirSync(join(valid, 'skill'), { recursive: true })
      writeFileSync(
        join(valid, 'skill', 'SKILL.md'),
        '---\nname: directory-valid\ndescription: Readable directory\n---\n'
      )
      const host = new PluginHost(
        new Registry(),
        new FilesystemSkillDiscovery(() => [unreadable, valid])
      )

      await host.activate({ manifest: { id: 'browser' }, activate: () => undefined })
      host.refreshSkills()

      expect(host.has('browser')).toBe(true)
      expect([...host.getSkills('browser')!.keys()]).toEqual(['browser_directory-valid'])
      expect(warning).toHaveBeenCalledOnce()
    } finally {
      warning.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refreshes discovered skills from disk without reactivating the plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-skills-'))
    const skillDirectory = join(root, 'plugins', 'agent', 'skills', 'dynamic')
    const skillPath = join(skillDirectory, 'SKILL.md')
    const activate = vi.fn()
    try {
      mkdirSync(skillDirectory, { recursive: true })
      writeFileSync(skillPath, '---\nname: first\ndescription: First\n---\n')
      const host = new PluginHost(
        new Registry(),
        new FilesystemSkillDiscovery(() => [join(root, 'plugins', 'agent', 'skills')])
      )
      await host.activate({ manifest: { id: 'agent' }, activate })

      host.refreshSkills()
      expect(host.getSkills('agent')?.has('agent_first')).toBe(true)

      writeFileSync(skillPath, '---\nname: second\ndescription: Second\n---\n')
      host.refreshSkills()

      expect(host.getSkills('agent')?.has('agent_first')).toBe(false)
      expect(host.getSkills('agent')?.has('agent_second')).toBe(true)
      expect(activate).toHaveBeenCalledOnce()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('disposes subscriptions in reverse order on deactivation', async () => {
    const calls: number[] = []
    const plugin: Plugin = {
      manifest: { id: 'test' },
      activate(context) {
        context.subscriptions.push(
          { dispose: () => calls.push(1) },
          { dispose: () => calls.push(2) }
        )
      }
    }
    const host = new PluginHost(new Registry())
    await host.activate(plugin)

    await host.deactivate('test')

    expect(calls).toEqual([2, 1])
    expect(host.has('test')).toBe(false)
  })

  it('rolls back subscriptions when activation fails', async () => {
    const dispose = vi.fn()
    const error = new Error('activation failed')
    const plugin: Plugin = {
      manifest: { id: 'broken' },
      activate(context) {
        context.subscriptions.push({ dispose })
        throw error
      }
    }
    const host = new PluginHost(new Registry())

    await expect(host.activate(plugin)).rejects.toBe(error)

    expect(dispose).toHaveBeenCalledOnce()
    expect(host.has('broken')).toBe(false)
  })

  it('prevents concurrent activation of the same plugin', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = new PluginHost(new Registry())
    const plugin: Plugin = {
      manifest: { id: 'test' },
      activate: () => pending
    }

    const activation = host.activate(plugin)
    await expect(host.activate(plugin)).rejects.toThrow('Plugin already active: test')
    release?.()
    await activation
  })

  it('does not remove a replacement when an old activation fails', async () => {
    let reject: ((error: Error) => void) | undefined
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise
    })
    const host = new PluginHost(new Registry())
    const activation = host.activate({ manifest: { id: 'test' }, activate: () => pending })

    await host.deactivate('test')
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('run', tool('replacement'))
      }
    })
    reject?.(new Error('old activation failed'))

    await expect(activation).rejects.toThrow('old activation failed')
    expect(host.getTools('test')?.get('test_run')?.description).toBe('replacement')
  })

  it('reloads a plugin by deactivating the previous instance', async () => {
    const dispose = vi.fn()
    const host = new PluginHost(new Registry())
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('run', tool('old'))
        context.subscriptions.push({ dispose })
      }
    })

    await host.reload({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('z', tool('z'))
        context.registerTool('run', tool('new'))
        context.registerTool('a', tool('a'))
      }
    })

    expect(dispose).toHaveBeenCalledOnce()
    expect(host.getTools('test')?.get('test_run')?.description).toBe('new')
    expect([...host.getTools('test')!.keys()]).toEqual(['test_a', 'test_run', 'test_z'])
  })

  it('leaves a plugin inactive when reload fails', async () => {
    const host = new PluginHost(new Registry())
    await host.activate({ manifest: { id: 'test' }, activate: () => undefined })

    await expect(
      host.reload({
        manifest: { id: 'test' },
        activate() {
          throw new Error('reload failed')
        }
      })
    ).rejects.toThrow('reload failed')

    expect(host.has('test')).toBe(false)
  })

  it('uses the latest contribution registered under a name', async () => {
    const plugin: Plugin = {
      manifest: { id: 'duplicate' },
      activate(context) {
        context.registerTool('run', tool('first'))
        context.registerTool('run', tool('second'))
      }
    }

    const host = new PluginHost(new Registry())
    await host.activate(plugin)

    expect(host.getTools('duplicate')?.get('duplicate_run')?.description).toBe('second')
  })

  it('returns contributions by plugin', async () => {
    const host = new PluginHost(new Registry())
    const createPlugin = (id: string): Plugin => ({
      manifest: { id },
      activate(context) {
        context.registerTool('z', tool('z'))
        context.registerTool('a', tool('a'))
      }
    })

    await host.activate(createPlugin('z'))
    await host.activate(createPlugin('a'))

    expect(host.listPlugins().map(({ id }) => id)).toEqual(['a', 'z'])
    expect([...host.getTools('a')!.keys()]).toEqual(['a_a', 'a_z'])
  })

  it('returns readonly plugin contributions', async () => {
    const host = new PluginHost(new Registry(), {
      discover: () => [
        { name: 'lazy', path: 'lazy.md', description: 'lazy' },
        { name: 'eager', path: 'eager.md', description: 'eager', metadata: { eager: true } }
      ]
    })
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('lazy', tool('lazy'))
        context.registerTool(
          'eager',
          defineTool({
            description: 'eager',
            metadata: { eager: true },
            inputSchema: z.object({}),
            execute: () => undefined
          })
        )
      }
    })
    host.refreshSkills()

    const tools = host.getTools('test')
    const skills = host.getSkills('test')
    expect([...tools!.keys()]).toEqual(['test_eager', 'test_lazy'])
    expect([...skills!.keys()]).toEqual(['test_eager', 'test_lazy'])
    expect(host.getTools('missing')).toBeUndefined()
    expect(host.getSkills('missing')).toBeUndefined()
  })

  it('rejects plugins that register invalid tools', async () => {
    const host = new PluginHost(new Registry())

    await expect(
      host.activate({
        manifest: { id: 'invalid' },
        activate(context) {
          context.registerTool('tool', { description: 'invalid' })
        }
      })
    ).rejects.toThrow('Tool input schema must be a Zod object or JSON object schema.')

    expect(host.has('invalid')).toBe(false)
  })

  it('continues disposing subscriptions after a failure', async () => {
    const dispose = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = new PluginHost(new Registry())
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.subscriptions.push(
          { dispose },
          {
            dispose() {
              throw new Error('dispose failed')
            }
          }
        )
      }
    })

    await host.deactivate('test')

    expect(dispose).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('disposes plugins in reverse activation order', async () => {
    const calls: string[] = []
    const host = new PluginHost(new Registry())
    for (const id of ['first', 'second']) {
      await host.activate({
        manifest: { id },
        activate(context) {
          context.subscriptions.push({ dispose: () => calls.push(id) })
        }
      })
    }

    await host.dispose()

    expect(calls).toEqual(['second', 'first'])
    expect(host.listPlugins()).toEqual([])
  })
})

describe('PluginHost.refreshPlugins', () => {
  const disk = (id: string, fingerprint: string, activate: Plugin['activate'] = () => undefined) => ({
    fingerprint,
    plugin: { manifest: { id }, activate } as Plugin
  })

  it('activates new disk plugins and tracks fingerprints', async () => {
    const host = new PluginHost(new Registry())
    const activate = vi.fn()

    await host.refreshPlugins([disk('gh', 'a:1', activate)])

    expect(host.has('gh')).toBe(true)
    expect(activate).toHaveBeenCalledOnce()
  })

  it('reloads a disk plugin when its fingerprint changes', async () => {
    const host = new PluginHost(new Registry())
    const activate = vi.fn()
    const dispose = vi.fn()
    const pluginWithDispose: Plugin['activate'] = (ctx) => {
      activate()
      ctx.subscriptions.push({ dispose })
    }

    await host.refreshPlugins([disk('gh', 'a:1', pluginWithDispose)])
    expect(activate).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()

    await host.refreshPlugins([disk('gh', 'b:2', pluginWithDispose)])

    expect(activate).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledOnce()
    expect(host.has('gh')).toBe(true)
  })

  it('keeps a disk plugin untouched when fingerprint is unchanged', async () => {
    const host = new PluginHost(new Registry())
    const activate = vi.fn()

    await host.refreshPlugins([disk('gh', 'a:1', activate)])
    await host.refreshPlugins([disk('gh', 'a:1', activate)])

    expect(activate).toHaveBeenCalledOnce()
  })

  it('deactivates a disk plugin that disappeared from discovered list', async () => {
    const host = new PluginHost(new Registry())
    const dispose = vi.fn()

    await host.refreshPlugins([
      disk('gh', 'a:1', (ctx) => ctx.subscriptions.push({ dispose }))
    ])
    await host.refreshPlugins([])

    expect(host.has('gh')).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('never reloads or removes builtin plugins not in pluginFingerprints', async () => {
    const host = new PluginHost(new Registry())
    const builtinActivate = vi.fn()
    await host.activate({ manifest: { id: 'builtin' }, activate: builtinActivate })

    await host.refreshPlugins([disk('gh', 'a:1', () => undefined)])
    expect(host.has('builtin')).toBe(true)
    expect(builtinActivate).toHaveBeenCalledOnce()

    await host.refreshPlugins([disk('gh', 'b:2', () => undefined)])
    expect(host.has('builtin')).toBe(true)
    expect(builtinActivate).toHaveBeenCalledOnce()

    await host.refreshPlugins([])
    expect(host.has('builtin')).toBe(true)
  })

  it('skips a disk plugin whose activate throws, keeping other plugins', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = new PluginHost(new Registry())
    const goodActivate = vi.fn()

    await host.refreshPlugins([
      disk('bad', 'a:1', () => { throw new Error('boom') }),
      disk('good', 'b:2', goodActivate)
    ])

    expect(host.has('bad')).toBe(false)
    expect(host.has('good')).toBe(true)
    expect(goodActivate).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('leaves a plugin inactive when reload throws; recovers on next refresh with same fingerprint', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = new PluginHost(new Registry())
    const dispose = vi.fn()

    await host.refreshPlugins([
      disk('gh', 'a:1', (ctx) => ctx.subscriptions.push({ dispose }))
    ])
    expect(host.has('gh')).toBe(true)
    expect(dispose).not.toHaveBeenCalled()

    await host.refreshPlugins([
      disk('gh', 'b:2', () => { throw new Error('reload-fail') })
    ])
    expect(host.has('gh')).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()

    const recoverActivate = vi.fn()
    await host.refreshPlugins([disk('gh', 'b:2', recoverActivate)])
    expect(host.has('gh')).toBe(true)
    expect(recoverActivate).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('tolerates duplicate ids inside a single discovered list (last fingerprint wins without double-activate)', async () => {
    const host = new PluginHost(new Registry())
    const activate = vi.fn()
    const firstActivate = vi.fn()

    await host.refreshPlugins([
      disk('gh', 'a:1', firstActivate),
      disk('gh', 'a:1', activate)
    ])

    expect(firstActivate).toHaveBeenCalledOnce()
    expect(activate).not.toHaveBeenCalled()
    expect(host.has('gh')).toBe(true)
  })
})
