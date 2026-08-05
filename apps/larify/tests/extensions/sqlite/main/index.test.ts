import { describe, expect, it } from 'vitest'
import { ExtensionHost } from '../../../../src/shared/extension'
import extension, { sqliteService } from '../../../../src/extensions/sqlite/main'
import { SqliteService } from '../../../../src/extensions/sqlite/main/sqlite-service'

describe('SQLite extension', () => {
  it('registers its service', async () => {
    const host = new ExtensionHost()

    await host.activate(extension)

    const service = host.getService(sqliteService)
    expect(service).toBeInstanceOf(SqliteService)
    const database = service!.open(':memory:')

    await host.deactivate(extension.name)

    expect(() => database.exec('SELECT 1')).toThrow()
  })
})
