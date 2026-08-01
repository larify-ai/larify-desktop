import type { Worker } from 'node:worker_threads'
import type { Node } from './graph'
import createWorker from './worker?nodeWorker'
import type { WorkerCommand, WorkerResponse } from './worker-protocol'

export class ContextWorker {
  private worker?: Worker
  private nextId = 0
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Node[] | boolean | undefined) => void
      reject: (error: Error) => void
    }
  >()

  async open(cwd: string): Promise<void> {
    await this.send({ type: 'open', cwd })
  }

  async search(cwd: string, query: string, limit?: number): Promise<Node[]> {
    const result = await this.send({ type: 'search', cwd, query, limit })
    return (result as Node[] | undefined) ?? []
  }

  async duplicateName(cwd: string, file: string, name: string): Promise<boolean> {
    return Boolean(await this.send({ type: 'duplicateName', cwd, file, name }))
  }

  async close(cwd: string): Promise<void> {
    await this.send({ type: 'close', cwd })
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    try {
      await this.send({ type: 'dispose' })
    } finally {
      try {
        await worker.terminate()
      } finally {
        if (this.worker === worker) this.worker = undefined
      }
    }
  }

  private send(request: WorkerCommand): Promise<Node[] | boolean | undefined> {
    const worker = this.worker ?? this.start()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...request, id })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  private start(): Worker {
    const worker = createWorker({})
    worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response.result)
    })
    worker.on('error', (error) => this.fail(error))
    worker.on('exit', (code) => {
      if (this.pending.size) this.fail(new Error(`Context worker exited with code ${code}.`))
      if (this.worker === worker) this.worker = undefined
    })
    this.worker = worker
    return worker
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
