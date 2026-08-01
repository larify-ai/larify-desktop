import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GraphIndex, type Node } from '../../../../src/extensions/context/main/graph'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function node(name: string): Node {
  return { name, description: `About ${name}`, uri: `file:///${name}.md` }
}

describe('context graph', () => {
  it('stores nodes idempotently and enforces unique names', () => {
    const graph = new GraphIndex(':memory:')

    expect(graph.upsert(node('A'), 'first', '1')).toBe(true)
    expect(graph.upsert(node('A'), 'first', '1')).toBe(true)
    expect(graph.hasName('A', node('A').uri)).toBe(false)
    expect(graph.hasName('A', 'file:///other.md')).toBe(true)
    expect(graph.upsert({ ...node('A'), uri: 'file:///other.md' }, '', '2')).toBe(false)
    expect(graph.nodes()).toEqual([node('A')])

    graph.close()
  })

  it('reads one node by URI and returns undefined when absent', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')

    expect(graph.node(node('A').uri)).toEqual(node('A'))
    expect(graph.node(node('Missing').uri)).toBeUndefined()
    graph.close()
  })

  it('enforces names case-insensitively', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Audio'), '', 'A')

    expect(graph.hasName('audio', 'file:///other.md')).toBe(true)
    expect(graph.upsert(node('audio'), '', 'B')).toBe(false)
    graph.close()
  })

  it('updates node metadata and replaces stale search content', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), 'old content', '1')
    graph.upsert({ ...node('A'), description: 'Updated' }, 'new content', '2')

    expect(graph.nodes()).toEqual([{ ...node('A'), description: 'Updated' }])
    expect(graph.search('old')).toEqual([])
    expect(graph.search('new').map(({ name }) => name)).toEqual(['A'])
    graph.close()
  })

  it('does not rebuild unchanged source hashes', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), 'original', 'same')
    graph.upsert({ ...node('A'), description: 'Ignored' }, 'replacement', 'same')

    expect(graph.node(node('A').uri)).toEqual(node('A'))
    expect(graph.search('original').map(({ name }) => name)).toEqual(['A'])
    expect(graph.search('replacement')).toEqual([])
    expect(graph.pendingEmbedding()?.hash).toBe('same')
    graph.close()
  })

  it('stores relations between nodes', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')
    graph.upsert(node('B'), '', 'B')

    graph.replaceEdges(node('A').uri, [node('B').uri])

    expect(graph.edges()).toEqual([{ source: 'A', target: 'B' }])

    graph.replaceEdges(node('A').uri, [])
    expect(graph.edges()).toEqual([])
    graph.close()
  })

  it('ignores duplicate edges', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')
    graph.upsert(node('B'), '', 'B')

    graph.replaceEdges(node('A').uri, [node('B').uri, node('B').uri])

    expect(graph.edges()).toEqual([{ source: 'A', target: 'B' }])
    graph.close()
  })

  it('rolls back an incomplete edge replacement', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')
    graph.upsert(node('B'), '', 'B')
    graph.upsert(node('C'), '', 'C')
    graph.replaceEdges(node('A').uri, [node('B').uri])

    function* failingTargets(): Generator<string> {
      yield node('C').uri
      throw new Error('Failed')
    }

    expect(() => graph.replaceEdges(node('A').uri, failingTargets())).toThrow('Failed')
    expect(graph.edges()).toEqual([{ source: 'A', target: 'B' }])
    graph.close()
  })

  it('preserves incoming edges while targets are missing', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')
    graph.upsert(node('B'), '', 'B')

    graph.replaceEdges(node('A').uri, [node('B').uri, node('missing').uri])
    graph.delete(node('B').uri)

    expect(graph.edges()).toEqual([])
    graph.upsert(node('B'), '', 'B')
    graph.upsert(node('missing'), '', 'missing')
    expect(graph.edges()).toEqual([
      { source: 'A', target: 'B' },
      { source: 'A', target: 'missing' }
    ])
    graph.close()
  })

  it('uses OR recall, BM25 ranking, and related-node expansion', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('BLE audio'), 'BLE audio microphone streaming', '1')
    graph.upsert(node('Microphone'), 'Audio input', '2')
    graph.upsert(node('蓝牙传输'), '通过低功耗蓝牙发送音频', '3')
    graph.replaceEdges(node('BLE audio').uri, [node('蓝牙传输').uri])

    expect(graph.search('BLE audio').map(({ name }) => name)).toEqual([
      'BLE audio',
      '蓝牙传输',
      'Microphone'
    ])
    expect(graph.search('音频').map(({ name }) => name)).toEqual(['蓝牙传输', 'BLE audio'])
    graph.close()
  })

  it('expands each BM25 match before the next match and respects the total limit', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('First'), 'audio audio audio', '1')
    graph.upsert(node('First neighbor'), '', '2')
    graph.upsert(node('Second'), 'audio', '3')
    graph.replaceEdges(node('First').uri, [node('First neighbor').uri])

    expect(graph.search('audio', 2).map(({ name }) => name)).toEqual(['First', 'First neighbor'])
    graph.close()
  })

  it('handles limits when a direct match is also a related node', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('First'), 'audio audio', '1')
    graph.upsert(node('Second'), 'audio', '2')
    graph.replaceEdges(node('First').uri, [node('Second').uri])

    expect(graph.search('audio', 1).map(({ name }) => name)).toEqual(['First'])
    expect(graph.search('audio', 2).map(({ name }) => name)).toEqual(['First', 'Second'])
    expect(graph.search('audio', 3).map(({ name }) => name)).toEqual(['First', 'Second'])
    graph.close()
  })

  it('ranks one-hop nodes by BM25 before unmatched neighbors', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('First'), 'audio audio audio audio', '1')
    graph.upsert(node('High neighbor'), 'audio audio', '2')
    graph.upsert(node('Low neighbor'), 'audio', '3')
    graph.upsert(node('Other neighbor'), '', '4')
    graph.replaceEdges(node('First').uri, [
      node('Other neighbor').uri,
      node('Low neighbor').uri,
      node('High neighbor').uri
    ])

    expect(graph.search('audio', 4).map(({ name }) => name)).toEqual([
      'First',
      'High neighbor',
      'Low neighbor',
      'Other neighbor'
    ])
    graph.close()
  })

  it('orders unmatched neighbors stably and removes duplicates', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('First'), 'audio audio', '1')
    graph.upsert(node('Second'), 'audio', '2')
    graph.upsert(node('A neighbor'), '', '3')
    graph.upsert(node('Z neighbor'), '', '4')
    graph.upsert(node('Shared neighbor'), '', '5')
    graph.replaceEdges(node('First').uri, [
      node('Z neighbor').uri,
      node('Shared neighbor').uri,
      node('A neighbor').uri
    ])
    graph.replaceEdges(node('Second').uri, [node('Shared neighbor').uri])

    expect(graph.search('audio', 6).map(({ name }) => name)).toEqual([
      'First',
      'A neighbor',
      'Shared neighbor',
      'Z neighbor',
      'Second'
    ])
    graph.close()
  })

  it('returns no results for empty queries or non-positive limits', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Audio'), 'audio', '1')

    expect(graph.search('')).toEqual([])
    expect(graph.search('audio', 0)).toEqual([])
    expect(graph.search('audio', -1)).toEqual([])
    graph.close()
  })

  it('restores nodes, edges, and search after reopening the database', () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-graph-'))
    roots.push(root)
    const path = join(root, 'index.db')
    const first = new GraphIndex(path)
    first.upsert(node('A'), 'persistent audio', 'A')
    first.upsert(node('B'), '', 'B')
    first.replaceEdges(node('A').uri, [node('B').uri])
    first.close()

    const second = new GraphIndex(path)
    expect(second.nodes()).toEqual([node('A'), node('B')])
    expect(second.edges()).toEqual([{ source: 'A', target: 'B' }])
    expect(second.search('persistent').map(({ name }) => name)).toEqual(['A', 'B'])
    second.close()
  })

  it('deletes stale nodes, relations, and search entries', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), 'searchable', 'A')
    graph.upsert(node('B'), '', 'B')
    graph.replaceEdges(node('A').uri, [node('B').uri])

    graph.deleteMissing([node('B').uri])

    expect(graph.nodes()).toEqual([node('B')])
    expect(graph.edges()).toEqual([])
    expect(graph.search('searchable')).toEqual([])
    graph.close()
  })

  it('keeps retained nodes and treats missing deletions as no-ops', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('A'), '', 'A')
    graph.upsert(node('B'), '', 'B')

    graph.delete(node('Missing').uri)
    graph.deleteMissing([node('A').uri, node('B').uri])

    expect(graph.nodes()).toEqual([node('A'), node('B')])
    graph.close()
  })

  it('tracks stale embeddings and performs semantic search', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Audio'), 'microphone', '1')
    graph.upsert(node('Bluetooth'), 'wireless', '2')

    expect(graph.pendingEmbedding()?.name).toBe('Audio')
    graph.setEmbeddings(node('Audio').uri, '1', [[1, 0]])
    expect(graph.pendingEmbedding()?.name).toBe('Bluetooth')
    graph.setEmbeddings(node('Bluetooth').uri, '2', [[0, 1]])

    expect(graph.pendingEmbedding()).toBeUndefined()
    expect(graph.hybridSearch('not-in-text', [0, 1]).map(({ name }) => name)).toEqual([
      'Bluetooth',
      'Audio'
    ])

    graph.upsert(node('Bluetooth'), 'updated', '3')
    expect(graph.pendingEmbedding()?.name).toBe('Bluetooth')
    graph.close()
  })

  it('ignores embeddings with incompatible dimensions', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Audio'), 'audio', '1')
    graph.setEmbeddings(node('Audio').uri, '1', [[1, 0]])

    expect(graph.hybridSearch('missing', [1])).toEqual([])
    graph.close()
  })

  it('retains only the highest-scoring semantic results', () => {
    const graph = new GraphIndex(':memory:')
    for (let score = 1; score <= 10; score++) {
      graph.upsert(node(`Node ${score}`), '', String(score))
      graph.setEmbeddings(node(`Node ${score}`).uri, String(score), [[score, 0]])
    }

    expect(graph.hybridSearch('missing', [1, 0], 3).map(({ name }) => name)).toEqual([
      'Node 10',
      'Node 9',
      'Node 8'
    ])
    graph.close()
  })

  it('ranks documents by their best chunk without returning duplicates', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Multi chunk'), '', 'multi')
    graph.upsert(node('Single chunk'), '', 'single')
    graph.setEmbeddings(node('Multi chunk').uri, 'multi', [
      [1, 0],
      [0, 1]
    ])
    graph.setEmbeddings(node('Single chunk').uri, 'single', [[0.8, 0]])

    expect(graph.hybridSearch('missing', [1, 0], 2).map(({ name }) => name)).toEqual([
      'Multi chunk',
      'Single chunk'
    ])
    graph.close()
  })

  it('fuses BM25 and semantic rankings when expanding related nodes', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Root'), 'query query query', 'root')
    graph.upsert(node('Lexical'), 'query query', 'lexical')
    graph.upsert(node('Hybrid'), 'query', 'hybrid')
    graph.upsert(node('Semantic'), '', 'semantic')
    graph.replaceEdges(node('Root').uri, [
      node('Lexical').uri,
      node('Hybrid').uri,
      node('Semantic').uri
    ])
    graph.setEmbeddings(node('Root').uri, 'root', [[2, 0]])
    graph.setEmbeddings(node('Lexical').uri, 'lexical', [[0, 1]])
    graph.setEmbeddings(node('Hybrid').uri, 'hybrid', [[1, 0]])
    graph.setEmbeddings(node('Semantic').uri, 'semantic', [[0.5, 0.5]])

    expect(graph.hybridSearch('query', [1, 0], 4).map(({ name }) => name)).toEqual([
      'Root',
      'Hybrid',
      'Lexical',
      'Semantic'
    ])
    graph.close()
  })

  it('rejects embeddings generated for an outdated file hash', () => {
    const graph = new GraphIndex(':memory:')
    graph.upsert(node('Audio'), 'first', '1')
    graph.upsert(node('Audio'), 'second', '2')
    graph.setEmbeddings(node('Audio').uri, '1', [[1, 0]])
    expect(graph.pendingEmbedding()?.name).toBe('Audio')

    graph.setEmbeddings(node('Audio').uri, '2', [[1, 0]])
    expect(graph.pendingEmbedding()).toBeUndefined()
    graph.close()
  })
})
