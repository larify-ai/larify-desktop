import type { DatabaseSync } from 'node:sqlite'
import { openDatabase, transaction } from '../../../main/core/sqlite'
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
    this.database = openDatabase(path)
    this.initialize()
  }

  upsert(node: Node, content: string, hash: string): boolean {
    return transaction(this.database, () => {
      if (this.hasName(node.name, node.uri)) return false
      const id = this.saveNode(node, hash)
      if (id !== undefined) {
        this.indexNode(id, node, content)
        this.database.prepare('DELETE FROM embeddings WHERE uri = ?').run(node.uri)
      }
      return true
    })
  }

  replaceEdges(source: string, targets: Iterable<string>): void {
    transaction(this.database, () => {
      this.database.prepare('DELETE FROM edges WHERE source = ?').run(source)
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO edges(source, target) VALUES (?, ?)'
      )
      for (const target of targets) insert.run(source, target)
    })
  }

  delete(uri: string): void {
    transaction(this.database, () => this.deleteNode(uri))
  }

  deleteMissing(uris: Iterable<string>): void {
    const retained = new Set(uris)
    transaction(this.database, () => {
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

  pendingEmbedding(): (Node & { hash: string }) | undefined {
    return this.database
      .prepare(
        `
        SELECT nodes.name, nodes.description, nodes.uri, nodes.hash
        FROM nodes
        WHERE NOT EXISTS (SELECT 1 FROM embeddings WHERE embeddings.uri = nodes.uri)
        ORDER BY nodes.name
        LIMIT 1
      `
      )
      .get() as (Node & { hash: string }) | undefined
  }

  setEmbeddings(uri: string, hash: string, vectors: number[][]): void {
    if (!this.database.prepare('SELECT 1 FROM nodes WHERE uri = ? AND hash = ?').get(uri, hash)) {
      return
    }
    transaction(this.database, () => {
      this.database.prepare('DELETE FROM embeddings WHERE uri = ?').run(uri)
      const insert = this.database.prepare('INSERT INTO embeddings(uri, vector) VALUES (?, ?)')
      for (const vector of vectors) {
        insert.run(uri, Buffer.from(new Float32Array(vector).buffer))
      }
    })
  }

  hybridSearch(query: string, vector: number[], limit = 20): Node[] {
    if (!query.trim() || limit <= 0) return []
    const match = searchQuery(query)
    const lexical = match ? this.matchingNodes(match, limit) : []
    const semantic = this.semanticNodes(vector, limit)
    const ranked = reciprocalRankFusion(lexical, semantic).slice(0, limit)
    return match ? this.expand(ranked, match, limit, vector) : ranked
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

  private expand(matches: Node[], match: string, limit: number, vector?: number[]): Node[] {
    const results: Node[] = []
    const seen = new Set<string>()
    for (const node of matches) {
      this.append(results, seen, node)
      if (results.length === limit) return results
      for (const related of this.related(node.uri, match, limit - results.length, seen, vector)) {
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

      CREATE TABLE IF NOT EXISTS embeddings (
        uri TEXT NOT NULL REFERENCES nodes(uri) ON DELETE CASCADE,
        vector BLOB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS embeddings_uri ON embeddings(uri);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name,
        description,
        content,
        tokenize = 'unicode61'
      );
    `)
  }

  private related(
    source: string,
    match: string,
    limit: number,
    excluded: Set<string>,
    vector?: number[]
  ): Node[] {
    const matched = this.matchingRelated(source, match, limit, excluded)
    const ranked = vector
      ? reciprocalRankFusion(matched, this.semanticRelated(source, vector, limit, excluded)).slice(
          0,
          limit
        )
      : matched
    if (ranked.length === limit) return ranked
    const seen = new Set([...excluded, ...ranked.map(({ uri }) => uri)])
    return [...ranked, ...this.unmatchedRelated(source, match, limit - ranked.length, seen)]
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

  private semanticRelated(
    source: string,
    query: number[],
    limit: number,
    excluded: Set<string>
  ): Node[] {
    const { clause, parameters } = this.exclusion(excluded)
    const rows = this.database
      .prepare(
        `
        WITH related(uri) AS (
          SELECT target FROM edges WHERE source = ?
          UNION
          SELECT source FROM edges WHERE target = ?
        )
        SELECT nodes.name, nodes.description, nodes.uri, embeddings.vector
        FROM related
        JOIN nodes ON nodes.uri = related.uri
        JOIN embeddings ON embeddings.uri = nodes.uri
        WHERE 1 ${clause}
        ORDER BY nodes.uri
      `
      )
      .iterate(source, source, ...parameters) as Iterable<Node & { vector: Uint8Array }>
    return this.rankBySimilarity(rows, query, limit)
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

  private semanticNodes(query: number[], limit: number): Node[] {
    const rows = this.database
      .prepare(
        `
        SELECT nodes.name, nodes.description, nodes.uri, embeddings.vector
          FROM embeddings
          JOIN nodes ON nodes.uri = embeddings.uri
          ORDER BY nodes.uri
      `
      )
      .iterate() as Iterable<Node & { vector: Uint8Array }>
    return this.rankBySimilarity(rows, query, limit)
  }

  private rankBySimilarity(
    rows: Iterable<Node & { vector: Uint8Array }>,
    query: number[],
    limit: number
  ): Node[] {
    const ranked: { node: Node; score: number }[] = []
    let current: { node: Node; score: number } | undefined
    for (const { vector, ...node } of rows) {
      const score = similarity(query, vector)
      if (!Number.isFinite(score)) continue
      if (current?.node.uri !== node.uri) {
        if (current) retain(ranked, current, limit)
        current = { node, score }
      } else {
        current.score = Math.max(current.score, score)
      }
    }
    if (current) retain(ranked, current, limit)
    return ranked.map(({ node }) => node)
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
}

function reciprocalRankFusion(...rankings: Node[][]): Node[] {
  const nodes = new Map<string, { node: Node; score: number }>()
  for (const ranking of rankings) {
    ranking.forEach((node, rank) => {
      const result = nodes.get(node.uri) ?? { node, score: 0 }
      result.score += 1 / (60 + rank + 1)
      nodes.set(node.uri, result)
    })
  }
  return [...nodes.values()].sort((a, b) => b.score - a.score).map(({ node }) => node)
}

function retain<T extends { score: number }>(ranked: T[], result: T, limit: number): void {
  const index = ranked.findIndex(({ score }) => score < result.score)
  if (index < 0) {
    if (ranked.length < limit) ranked.push(result)
    return
  }
  ranked.splice(index, 0, result)
  if (ranked.length > limit) ranked.pop()
}

function similarity(query: number[], bytes: Uint8Array): number {
  const vector = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  )
  if (query.length !== vector.length) return Number.NEGATIVE_INFINITY
  return query.reduce((score, value, index) => score + value * vector[index], 0)
}
