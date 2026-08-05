import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, transaction } from '../../../src/main/core/sqlite'

describe('SQLite core', () => {
  it('opens a database and commits a transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-sqlite-'))
    const database = openDatabase(join(directory, 'data', 'test.db'))
    try {
      database.exec('CREATE TABLE values_table (value TEXT)')
      transaction(database, () => database.prepare('INSERT INTO values_table VALUES (?)').run('ok'))

      expect(database.prepare('SELECT value FROM values_table').get()).toEqual({ value: 'ok' })
    } finally {
      database.close()
      await rm(directory, { recursive: true })
    }
  })

  it('rolls back a failed transaction', () => {
    const database = openDatabase(':memory:')
    database.exec('CREATE TABLE values_table (value TEXT)')

    expect(() =>
      transaction(database, () => {
        database.prepare('INSERT INTO values_table VALUES (?)').run('discarded')
        throw new Error('failed')
      })
    ).toThrow('failed')
    expect(database.prepare('SELECT value FROM values_table').all()).toEqual([])
    database.close()
  })
})
