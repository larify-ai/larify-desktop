import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { searchQuery, tokenize } from '../../../../src/extensions/context/main/tokenizer'

const databases: DatabaseSync[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('context tokenizer', () => {
  it('tokenizes Chinese, English, and mixed text', () => {
    expect(tokenize('音频采集')).toBe('音频 采集')
    expect(tokenize('BLE audio')).toBe('BLE audio')
    expect(tokenize('中文English混合')).toBe('中文 English 混合')
  })

  it('ignores whitespace', () => {
    expect(tokenize(' \t\r\n')).toBe('')
    expect(searchQuery(' \t\r\n')).toBe('')
  })

  it('builds an OR query from quoted terms', () => {
    expect(searchQuery('BLE audio')).toBe('"BLE" OR "audio"')
    expect(searchQuery('音频采集')).toBe('"音频" OR "采集"')
  })

  it('runs generated queries against SQLite FTS5', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec("CREATE VIRTUAL TABLE documents USING fts5(content, tokenize = 'unicode61')")
    database
      .prepare('INSERT INTO documents(content) VALUES (?)')
      .run(tokenize('持续音频采集 over BLE'))

    expect(
      database
        .prepare('SELECT count(*) AS count FROM documents WHERE documents MATCH ?')
        .get(searchQuery('音频 BLE'))
    ).toEqual({ count: 1 })
  })
})
