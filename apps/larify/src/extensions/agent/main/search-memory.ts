import { z } from 'zod'
import type { Registry } from '@shared/infra/registry'
import { defineTool, type Tool } from '../../../main/core/plugin/protocol'
import { contextWorkerToken } from '../../context/main/service'

interface MemorySearch {
  search(query: string, limit?: number): Promise<unknown>
}

export function createSearchMemoryTool(registry: Registry): Tool {
  return defineTool({
    description: 'Search relevant memory using hybrid retrieval (BM25 and vector).',
    inputSchema: z
      .object({
        query: z.string().trim().min(1).describe('Search query'),
        limit: z.number().int().positive().max(100).default(20).describe('Maximum results')
      })
      .strict(),
    metadata: { eager: true, icon: 'search' },
    execute: ({ query, limit = 20 }) => {
      const memory = registry.get<MemorySearch>(contextWorkerToken)
      if (!memory) throw new Error('Memory search is unavailable.')
      return memory.search(query, limit)
    }
  })
}
