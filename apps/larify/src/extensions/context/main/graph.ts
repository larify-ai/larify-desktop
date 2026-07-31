import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { larifyPath } from '../../../main/utils/app-paths'
import { searchQuery, tokenize } from './tokenizer'

export interface Node {
  name: string
  description: string
  uri: string
}

export interface Edge {
  source: string
  target: string
  description: string
}

export class GraphIndex {
  private readonly database: DatabaseSync

  constructor(path = larifyPath('indexes', 'context.db')) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.initialize()
  }

  upsert(node: Node, content: string, hash: string): boolean {
    return this.transaction(() => {
      const conflict = this.database
        .prepare('SELECT 1 FROM nodes WHERE name = ? COLLATE NOCASE AND uri <> ?')
        .get(node.name, node.uri)
      if (conflict) return false

      const saved = this.database
        .prepare(
          `
          INSERT INTO nodes(name, description, uri, hash) VALUES (?, ?, ?, ?)
          ON CONFLICT(uri) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            hash = excluded.hash
          WHERE nodes.hash <> excluded.hash
          RETURNING id
        `
        )
        .get(node.name, node.description, node.uri, hash) as { id: number } | undefined
      if (!saved) return true

      this.database.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(saved.id)
      this.database
        .prepare('INSERT INTO nodes_fts(rowid, name, description, content) VALUES (?, ?, ?, ?)')
        .run(saved.id, tokenize(node.name), tokenize(node.description), tokenize(content))
      return true
    })
  }

  replaceEdges(sourceUri: string, edges: { targetUri: string; description: string }[]): void {
    this.transaction(() => {
      this.database.prepare('DELETE FROM relations WHERE source = ?').run(sourceUri)
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO relations(source, target, description) VALUES (?, ?, ?)'
      )
      for (const edge of edges) insert.run(sourceUri, edge.targetUri, edge.description)
    })
  }

  delete(uri: string): void {
    this.transaction(() => {
      const deleted = this.database
        .prepare('DELETE FROM nodes WHERE uri = ? RETURNING id')
        .get(uri) as { id: number } | undefined
      if (deleted) this.database.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(deleted.id)
    })
  }

  deleteMissing(uris: Iterable<string>): void {
    const retained = new Set(uris)
    for (const { uri } of this.database.prepare('SELECT uri FROM nodes').all() as {
      uri: string
    }[]) {
      if (!retained.has(uri)) this.delete(uri)
    }
  }

  nodes(): Node[] {
    return this.database
      .prepare('SELECT name, description, uri FROM nodes ORDER BY name')
      .all() as unknown as Node[]
  }

  edges(): Edge[] {
    return this.database
      .prepare(
        `
        SELECT source.name AS source, target.name AS target, relations.description
        FROM relations
        JOIN nodes AS source ON source.uri = relations.source
        JOIN nodes AS target ON target.uri = relations.target
        ORDER BY source.name, target.name, relations.description
      `
      )
      .all() as unknown as Edge[]
  }

  search(query: string, limit = 20): Node[] {
    const match = searchQuery(query)
    if (!match) return []
    const matches = this.database
      .prepare(
        `
        SELECT nodes.name, nodes.description, nodes.uri
        FROM nodes_fts
        JOIN nodes ON nodes.id = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
        ORDER BY bm25(nodes_fts)
        LIMIT ?
      `
      )
      .all(match, limit) as unknown as Node[]
    return [...matches, ...this.related(matches.map(({ name }) => name))]
  }

  close(): void {
    this.database.close()
  }

  private initialize(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      DROP TABLE IF EXISTS edges;

      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        uri TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relations (
        source TEXT NOT NULL REFERENCES nodes(uri) ON DELETE CASCADE,
        target TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY(source, target, description)
      );

      CREATE INDEX IF NOT EXISTS relations_target ON relations(target);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name,
        description,
        content,
        tokenize = 'unicode61'
      );
    `)
  }

  private related(names: string[]): Node[] {
    if (!names.length) return []
    const values = names.map(() => '(?)').join(', ')
    return this.database
      .prepare(
        `
        WITH matches(name) AS (VALUES ${values}),
        matched_nodes AS (
          SELECT nodes.name, nodes.uri
          FROM matches
          JOIN nodes ON nodes.name = matches.name
        ),
        related(uri) AS (
          SELECT relations.target
          FROM matched_nodes
          JOIN relations ON relations.source = matched_nodes.uri
          UNION
          SELECT relations.source
          FROM matched_nodes
          JOIN relations ON relations.target = matched_nodes.uri
        )
        SELECT DISTINCT nodes.name, nodes.description, nodes.uri
        FROM related
        JOIN nodes ON nodes.uri = related.uri
        WHERE nodes.name NOT IN (SELECT name FROM matched_nodes)
        ORDER BY nodes.name
      `
      )
      .all(...names) as unknown as Node[]
  }

  private transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
