import { describe, expect, it, vi } from 'vitest'
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingService,
  RETRIEVAL_TASK,
  formatQuery,
  type EmbeddingExtractor
} from '../../../../src/extensions/embedding/main/service'

function vector(value: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value)
}

describe('EmbeddingService', () => {
  it('uses the official Qwen retrieval instruction and inference options', async () => {
    const extractor = vi.fn(async () => ({
      tolist: () => [vector(1)]
    }))
    const service = new EmbeddingService({
      loadExtractor: async () => extractor as EmbeddingExtractor
    })

    await expect(service.embedQuery('如何使用 ONNX？')).resolves.toHaveLength(EMBEDDING_DIMENSIONS)
    expect(extractor).toHaveBeenCalledWith(`Instruct: ${RETRIEVAL_TASK}\nQuery:如何使用 ONNX？`, {
      pooling: 'last_token',
      normalize: true,
      truncation: true,
      max_length: 1024
    })
    expect(formatQuery('test')).toBe(`Instruct: ${RETRIEVAL_TASK}\nQuery:test`)
  })

  it('serializes concurrent requests and loads the model once', async () => {
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    const loadExtractor = vi.fn(async () => {
      const extractor: EmbeddingExtractor = async (input) => {
        active++
        maximumActive = Math.max(maximumActive, active)
        order.push(`start:${input}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(`end:${input}`)
        active--
        return {
          tolist: () => [vector(1)]
        }
      }
      return extractor
    })
    const service = new EmbeddingService({ loadExtractor })

    await Promise.all([
      service.embedQuery('first'),
      service.embedDocuments(['second', 'third', 'fourth']),
      service.embedQuery('fifth')
    ])

    expect(maximumActive).toBe(1)
    expect(loadExtractor).toHaveBeenCalledOnce()
    expect(order).toEqual([
      `start:${formatQuery('first')}`,
      `end:${formatQuery('first')}`,
      'start:second',
      'end:second',
      'start:third',
      'end:third',
      'start:fourth',
      'end:fourth',
      `start:${formatQuery('fifth')}`,
      `end:${formatQuery('fifth')}`
    ])
  })

  it('continues the queue after a failed request', async () => {
    let calls = 0
    const service = new EmbeddingService({
      loadExtractor: async () => async () => {
        calls++
        if (calls === 1) throw new Error('failed')
        return {
          tolist: () => [vector(1)]
        }
      }
    })

    await expect(service.embedQuery('first')).rejects.toThrow('failed')
    await expect(service.embedQuery('second')).resolves.toHaveLength(EMBEDDING_DIMENSIONS)
  })

  it('retries model loading after a transient failure', async () => {
    const loadExtractor = vi.fn(async () => {
      if (loadExtractor.mock.calls.length === 1) throw new Error('download failed')
      return async () => ({
        tolist: () => [vector(1)]
      })
    })
    const service = new EmbeddingService({ loadExtractor })

    await expect(service.embedQuery('first')).rejects.toThrow('download failed')
    await expect(service.embedQuery('second')).resolves.toHaveLength(EMBEDDING_DIMENSIONS)
    expect(loadExtractor).toHaveBeenCalledTimes(2)
  })
})
