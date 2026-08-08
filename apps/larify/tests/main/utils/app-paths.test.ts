import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { app, mkdirSync } = vi.hoisted(() => ({
  app: { getPath: vi.fn(), isPackaged: false },
  mkdirSync: vi.fn()
}))
vi.mock('electron', () => ({ app }))
vi.mock('node:fs', () => ({ mkdirSync }))

import {
  resourcePath,
  sessionAttachmentsPath
} from '../../../src/main/utils/app-paths'

beforeEach(() => {
  app.getPath.mockReturnValue(join('C:', 'Larify'))
  mkdirSync.mockClear()
})

describe('resourcePath', () => {
  const original = process.resourcesPath

  afterEach(() => {
    app.isPackaged = false
    ;(process as { resourcesPath?: string }).resourcesPath = original
  })

  it("resolves against ./resources in development", () => {
    app.isPackaged = false

    expect(resourcePath('shell-integration', 'shellIntegration.ps1')).toBe(
      join(process.cwd(), 'resources', 'shell-integration', 'shellIntegration.ps1')
    )
  })

  it("resolves into app.asar.unpacked/resources when packaged", () => {
    app.isPackaged = true
    ;(process as { resourcesPath?: string }).resourcesPath = join('/opt', 'larify', 'resources')

    expect(resourcePath('shell-integration', 'shellIntegration.ps1')).toBe(
      join(
        '/opt',
        'larify',
        'resources',
        'app.asar.unpacked',
        'resources',
        'shell-integration',
        'shellIntegration.ps1'
      )
    )
  })
})

describe('sessionAttachmentsPath', () => {
  it('creates and returns the session attachment directory', () => {
    const sessionId = 'c4b8983e-c431-49ea-a9d5-2ff07c22951b'
    const path = sessionAttachmentsPath(sessionId)

    expect(path).toBe(join('C:', 'Larify', 'attachments', sessionId))
    expect(mkdirSync).toHaveBeenCalledWith(path, { recursive: true })
  })
})
