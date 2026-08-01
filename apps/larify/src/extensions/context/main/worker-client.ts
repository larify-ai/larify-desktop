import type { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import type { EmbeddingWorker } from '../../embedding/main/worker-client'
import type { ContextDocument } from './document'
import type { Node } from './graph'
import createWorker from './worker?nodeWorker'
import type { WorkerCommand, WorkerNotification, WorkerResponse } from './worker-protocol'

export class ContextWorker {
  private worker?: Worker
  private nextId = 0
  private readonly active = new Set<string>()
  private readonly syncing = new Set<string>()
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Node[] | ContextDocument | boolean | undefined) => void
      reject: (error: Error) => void
    }
  >()

  constructor(private readonly getEmbeddings?: () => EmbeddingWorker | undefined) {}

  async open(cwd: string): Promise<void> {
    this.active.add(resolve(cwd))
    await this.send({ type: 'open', cwd })
    this.updateEmbeddings(cwd)
  }

  async search(cwd: string, query: string, limit?: number): Promise<Node[]> {
    if (!query.trim() || (limit !== undefined && limit <= 0)) return []
    this.active.add(resolve(cwd))
    const embeddings = this.getEmbeddings?.()
    if (embeddings) {
      this.updateEmbeddings(cwd)
      try {
        const vector = await embeddings.embedQuery(query)
        return ((await this.send({ type: 'search', cwd, query, vector, limit })) ?? []) as Node[]
      } catch (error) {
        console.error('[context:embedding]', error)
      }
    }
    return ((await this.send({ type: 'search', cwd, query, limit })) ?? []) as Node[]
  }

  async duplicateName(cwd: string, file: string, name: string): Promise<boolean> {
    return Boolean(await this.send({ type: 'duplicateName', cwd, file, name }))
  }

  async close(cwd: string): Promise<void> {
    this.active.delete(resolve(cwd))
    await this.send({ type: 'close', cwd })
  }

  async dispose(): Promise<void> {
    this.active.clear()
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

  private async syncEmbeddings(cwd: string, embeddings: EmbeddingWorker): Promise<void> {
    const workspace = resolve(cwd)
    while (true) {
      if (!this.active.has(workspace)) return
      const pending = (await this.send({ type: 'pending-embedding', cwd })) as
        ContextDocument | undefined
      if (!pending) return
      const { node, content, hash } = pending
      const { name, description, uri } = node
      if (!this.active.has(workspace)) return
      const vectors = await embeddings.embedMarkdown({ name, description, content })
      if (!this.active.has(workspace)) return
      if (!vectors.length) throw new Error(`No embeddings generated for ${uri}.`)
      await this.send({ type: 'set-embeddings', cwd, uri, hash, vectors })
    }
  }

  private updateEmbeddings(cwd: string): void {
    const workspace = resolve(cwd)
    const embeddings = this.getEmbeddings?.()
    if (!embeddings || !this.active.has(workspace) || this.syncing.has(workspace)) return
    this.syncing.add(workspace)
    void this.syncEmbeddings(cwd, embeddings)
      .catch((error) => console.error('[context:embedding]', error))
      .finally(() => this.syncing.delete(workspace))
  }

  private send(request: WorkerCommand): Promise<Node[] | ContextDocument | boolean | undefined> {
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
    worker.on('message', (response: WorkerResponse | WorkerNotification) => {
      if ('type' in response) {
        this.updateEmbeddings(response.cwd)
        return
      }
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response.result)
    })
    worker.on('error', (error) => {
      if (this.worker !== worker) return
      this.worker = undefined
      this.fail(error)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.pending.size) this.fail(new Error(`Context worker exited with code ${code}.`))
    })
    this.worker = worker
    return worker
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
