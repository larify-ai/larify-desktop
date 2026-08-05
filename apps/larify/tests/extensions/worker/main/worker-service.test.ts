import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkerService } from '../../../../src/extensions/worker/main/worker-service'

const directories: string[] = []
const services: WorkerService[] = []
const worker = new URL('./worker.mjs', import.meta.url).href
const arithmeticWorker = new URL('./arithmetic-worker.mjs', import.meta.url).href
const echoWorker = new URL('./echo-worker.mjs', import.meta.url).href

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.destroy()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function experiment(): Promise<{ path: string; service: WorkerService }> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-worker-'))
  const service = new WorkerService()
  directories.push(directory)
  services.push(service)
  return { path: join(directory, 'experiment.db'), service }
}

describe('WorkerService', () => {
  it('executes work outside the main thread', async () => {
    const { path, service } = await experiment()
    const result = await service.run<unknown, { threadId: number; value: unknown }>(worker, {
      path,
      sql: "CREATE TABLE items (value TEXT); INSERT INTO items VALUES ('worker')",
      query: 'SELECT value FROM items'
    })

    expect(result).toEqual({ threadId: expect.any(Number), value: { value: 'worker' } })
    expect(result.threadId).not.toBe(0)
  })

  it('runs concurrent tasks', async () => {
    const { path, service } = await experiment()

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, value) =>
        service.run<unknown, { threadId: number }>(worker, {
          path: `${path}-${value}`,
          query: 'SELECT 1'
        })
      )
    )

    expect(results).toHaveLength(4)
    expect(results.every(({ threadId }) => threadId !== 0)).toBe(true)
  })

  it('runs different modules through the same service', async () => {
    const { path, service } = await experiment()

    const [database, sum] = await Promise.all([
      service.run<unknown, { value: unknown }>(worker, { path, query: 'SELECT 1 AS value' }),
      service.run<unknown, number>(arithmeticWorker, { left: 2, right: 3 })
    ])

    expect(database.value).toEqual({ value: 1 })
    expect(sum).toBe(5)
  })

  it('clones structured input and output', async () => {
    const { service } = await experiment()
    const input = {
      bytes: new Uint8Array([1, 2, 3]),
      date: new Date('2026-08-05T00:00:00.000Z'),
      map: new Map([['key', 'value']])
    }

    const result = await service.run<typeof input, typeof input>(echoWorker, input)

    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it('continues after a task fails', async () => {
    const { path, service } = await experiment()

    await expect(service.run(worker, { path, sql: 'invalid sql' })).rejects.toThrow()
    await expect(
      service.run<unknown, number>(arithmeticWorker, { left: 20, right: 22 })
    ).resolves.toBe(42)
  })

  it('rejects an invalid module path', async () => {
    const { service } = await experiment()

    await expect(service.run('missing-worker.mjs', undefined)).rejects.toThrow()
  })

  it('returns errors and releases resources when destroyed', async () => {
    const { path, service } = await experiment()

    await expect(service.run(worker, { path, sql: 'invalid sql' })).rejects.toThrow()
    await service.destroy()
    services.splice(services.indexOf(service), 1)

    await rm(path)
  })

  it('can be destroyed repeatedly', async () => {
    const { service } = await experiment()

    await service.destroy()
    await expect(service.destroy()).resolves.toBeUndefined()
    services.splice(services.indexOf(service), 1)
  })
})
