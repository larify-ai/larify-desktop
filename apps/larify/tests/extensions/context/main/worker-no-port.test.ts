import { expect, it, vi } from 'vitest'

vi.mock('node:worker_threads', () => ({ parentPort: null }))
vi.mock('chokidar', () => ({ watch: vi.fn() }))
vi.mock('../../../../src/extensions/context/main/indexer', () => ({
  buildContextGraph: vi.fn(),
  updateContext: vi.fn()
}))

it('requires a worker parent port', async () => {
  await expect(import('../../../../src/extensions/context/main/worker')).rejects.toThrow(
    'Context worker requires a parent port.'
  )
})
