import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '../../../../src/extensions/sqlite/main/sqlite-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function databasePath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-sqlite-'))
  directories.push(directory)
  return join(directory, name)
}

describe('SqliteService', () => {
  it('opens independent databases', async () => {
    const service = new SqliteService()
    const first = service.open(await databasePath('first.db'))
    const second = service.open(await databasePath('second.db'))

    first.exec("CREATE TABLE items (value TEXT); INSERT INTO items VALUES ('first')")
    second.exec("CREATE TABLE items (value TEXT); INSERT INTO items VALUES ('second')")

    expect(first.prepare('SELECT value FROM items').get()).toEqual({ value: 'first' })
    expect(second.prepare('SELECT value FROM items').get()).toEqual({ value: 'second' })

    service.closeAll()
  })

  it('closes one database', async () => {
    const service = new SqliteService()
    const database = service.open(await databasePath('index.db'))

    service.close(database)

    expect(() => database.exec('SELECT 1')).toThrow()
  })

  it('closes every database', async () => {
    const service = new SqliteService()
    const first = service.open(await databasePath('first.db'))
    const second = service.open(await databasePath('second.db'))

    service.closeAll()

    expect(() => first.exec('SELECT 1')).toThrow()
    expect(() => second.exec('SELECT 1')).toThrow()
  })
})
