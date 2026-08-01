import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { searchQuery, tokenize } from './tokenizer'

export interface Node {
  name: string
  description: string
  uri: string
}

export interface Edge {
  source: string
  target: string
}

export class GraphIndex {
  private readonly database: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.initialize()
  }

  upsert(node: Node, content: string, hash: string): boolean {
    return this.transaction(() => {
      if (this.hasName(node.name, node.uri)) return false
      const id = this.saveNode(node, hash)
      if (id !== undefined) this.indexNode(id, node, content)
      return true
    })
  }

  replaceEdges(source: string, targets: Iterable<string>): void {
    this.transaction(() => {
      this.database.prepare('DELETE FROM edges WHERE source = ?').run(source)
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO edges(source, target) VALUES (?, ?)'
      )
      for (const target of targets) insert.run(source, target)
    })
  }

  delete(uri: string): void {
    this.transaction(() => this.deleteNode(uri))
  }

  deleteMissing(uris: Iterable<string>): void {
    const retained = new Set(uris)
    this.transaction(() => {
      for (const { uri } of this.database.prepare('SELECT uri FROM nodes').all() as {
        uri: string
      }[]) {
        if (!retained.has(uri)) this.deleteNode(uri)
      }
    })
  }

  nodes(): Node[] {
    return this.database
      .prepare('SELECT name, description, uri FROM nodes ORDER BY name')
      .all() as unknown as Node[]
  }

  node(uri: string): Node | undefined {
    return this.database
      .prepare('SELECT name, description, uri FROM nodes WHERE uri = ?')
      .get(uri) as Node | undefined
  }

  hasName(name: string, exceptUri: string): boolean {
    return Boolean(
      this.database
        .prepare('SELECT 1 FROM nodes WHERE name = ? COLLATE NOCASE AND uri <> ?')
        .get(name, exceptUri)
    )
  }

  edges(): Edge[] {
    return this.database
      .prepare(
        `
        SELECT source.name AS source, target.name AS target
        FROM edges
        JOIN nodes AS source ON source.uri = edges.source
        JOIN nodes AS target ON target.uri = edges.target
        ORDER BY source.name, target.name
      `
      )
      .all() as unknown as Edge[]
  }

  search(query: string, limit = 20): Node[] {
    const match = searchQuery(query)
    if (!match || limit <= 0) return []
    return this.expand(this.matchingNodes(match, limit), match, limit)
  }

  close(): void {
    this.database.close()
  }

  private matchingNodes(match: string, limit: number): Node[] {
    return this.database
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
  }

  private expand(matches: Node[], match: string, limit: number): Node[] {
    const results: Node[] = []
    const seen = new Set<string>()
    for (const node of matches) {
      this.append(results, seen, node)
      if (results.length === limit) return results
      for (const related of this.related(node.uri, match, limit - results.length, seen)) {
        this.append(results, seen, related)
      }
      if (results.length === limit) return results
    }
    return results
  }

  private initialize(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        uri TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        source TEXT NOT NULL REFERENCES nodes(uri) ON DELETE CASCADE,
        target TEXT NOT NULL,
        PRIMARY KEY(source, target)
      );

      CREATE INDEX IF NOT EXISTS edges_target ON edges(target);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name,
        description,
        content,
        tokenize = 'unicode61'
      );
    `)
  }

  private related(source: string, match: string, limit: number, excluded: Set<string>): Node[] {
    const matched = this.matchingRelated(source, match, limit, excluded)
    if (matched.length === limit) return matched
    return [...matched, ...this.unmatchedRelated(source, match, limit - matched.length, excluded)]
  }

  private matchingRelated(
    source: string,
    match: string,
    limit: number,
    excluded: Set<string>
  ): Node[] {
    const { clause, parameters } = this.exclusion(excluded)
    return this.database
      .prepare(
        `
        WITH related(uri) AS (
          SELECT target FROM edges WHERE source = ?
          UNION
          SELECT source FROM edges WHERE target = ?
        )
        SELECT nodes.name, nodes.description, nodes.uri
        FROM related
        JOIN nodes ON nodes.uri = related.uri
        JOIN nodes_fts ON nodes_fts.rowid = nodes.id
        WHERE nodes_fts MATCH ? ${clause}
        ORDER BY bm25(nodes_fts)
        LIMIT ?
      `
      )
      .all(source, source, match, ...parameters, limit) as unknown as Node[]
  }

  private unmatchedRelated(
    source: string,
    match: string,
    limit: number,
    excluded: Set<string>
  ): Node[] {
    const { clause, parameters } = this.exclusion(excluded)
    return this.database
      .prepare(
        `
        WITH related(uri) AS (
          SELECT target FROM edges WHERE source = ?
          UNION
          SELECT source FROM edges WHERE target = ?
        )
        SELECT nodes.name, nodes.description, nodes.uri
        FROM related
        JOIN nodes ON nodes.uri = related.uri
        WHERE nodes.id NOT IN (SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?)
          ${clause}
        ORDER BY nodes.name
        LIMIT ?
      `
      )
      .all(source, source, match, ...parameters, limit) as unknown as Node[]
  }

  private exclusion(excluded: Set<string>): { clause: string; parameters: string[] } {
    const parameters = [...excluded]
    const placeholders = parameters.map(() => '?').join(', ')
    return {
      clause: `AND nodes.uri NOT IN (${placeholders})`,
      parameters
    }
  }

  private append(results: Node[], seen: Set<string>, node: Node): void {
    if (seen.has(node.uri)) return
    seen.add(node.uri)
    results.push(node)
  }

  private saveNode(node: Node, hash: string): number | undefined {
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
    return saved?.id
  }

  private indexNode(id: number, node: Node, content: string): void {
    this.database.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(id)
    this.database
      .prepare('INSERT INTO nodes_fts(rowid, name, description, content) VALUES (?, ?, ?, ?)')
      .run(id, tokenize(node.name), tokenize(node.description), tokenize(content))
  }

  private deleteNode(uri: string): void {
    const deleted = this.database
      .prepare('DELETE FROM nodes WHERE uri = ? RETURNING id')
      .get(uri) as { id: number } | undefined
    if (deleted) this.database.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(deleted.id)
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
