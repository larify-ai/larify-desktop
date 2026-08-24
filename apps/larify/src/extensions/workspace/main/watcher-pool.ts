import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'

type ChangeListener = (path: string) => void

const WATCH_READY_TIMEOUT_MS = 5_000

interface WatcherEntry {
  active: Set<WatcherSubscription>
  reconcileTask: Promise<void>
  root: string
  subscriptions: Set<WatcherSubscription>
  watchers: Map<string, WatcherRecord>
}

interface WatcherRecord {
  ready: boolean
  watcher: FSWatcher
}

export interface WorkspaceWatcherSubscription {
  add(directory: string): Promise<void>
  dispose(): Promise<void>
  setActive(active: boolean): Promise<void>
}

export class WorkspaceWatcherPool {
  private readonly entries = new Map<string, WatcherEntry>()

  acquire(root: string, listener: ChangeListener, active: boolean): WorkspaceWatcherSubscription {
    root = path.normalize(root)
    const entry = this.entries.get(root) ?? this.createEntry(root)
    const directories = new Set([root])
    let disposed = false
    const subscription: WatcherSubscription = {
      active,
      directories,
      listener,
      add: async (directory) => {
        directory = path.normalize(directory)
        if (disposed) return
        directories.add(directory)
        if (subscription.active) await this.queueReconcile(entry)
      },
      dispose: async () => {
        if (!disposed) {
          disposed = true
          entry.active.delete(subscription)
          entry.subscriptions.delete(subscription)
        }
        await this.queueReconcile(entry)
        if (entry.subscriptions.size === 0) this.entries.delete(root)
      },
      setActive: async (next) => {
        if (disposed) return
        if (subscription.active !== next) {
          subscription.active = next
          if (next) entry.active.add(subscription)
          else entry.active.delete(subscription)
        }
        await this.queueReconcile(entry)
      }
    }
    entry.subscriptions.add(subscription)
    if (active) entry.active.add(subscription)
    return subscription
  }

  private createEntry(root: string): WatcherEntry {
    const entry: WatcherEntry = {
      active: new Set(),
      reconcileTask: Promise.resolve(),
      root,
      subscriptions: new Set(),
      watchers: new Map()
    }
    this.entries.set(root, entry)
    return entry
  }

  private queueReconcile(entry: WatcherEntry): Promise<void> {
    const task = entry.reconcileTask.then(() => this.reconcile(entry))
    entry.reconcileTask = task.catch(() => undefined)
    return task
  }

  private async reconcile(entry: WatcherEntry): Promise<void> {
    if (entry.active.size === 0) {
      for (const [directory, record] of entry.watchers) {
        await record.watcher.close()
        entry.watchers.delete(directory)
      }
      return
    }
    const directories = new Set([entry.root])
    for (const subscription of entry.active) {
      for (const directory of subscription.directories) directories.add(directory)
    }
    for (const directory of directories) {
      const existing = entry.watchers.get(directory)
      if (existing?.ready) continue
      if (existing) {
        await existing.watcher.close()
        entry.watchers.delete(directory)
      }
      await this.startWatcher(entry, directory)
    }
    for (const [directory, record] of entry.watchers) {
      if (directories.has(directory)) continue
      await record.watcher.close()
      entry.watchers.delete(directory)
    }
  }

  private async startWatcher(entry: WatcherEntry, directory: string): Promise<void> {
    const watcher = watch(directory, { atomic: true, depth: 0, ignoreInitial: true })
    const record = { ready: false, watcher }
    entry.watchers.set(directory, record)
    watcher.on('all', (_event, changedPath) => {
      const normalized = path.normalize(changedPath)
      for (const subscription of entry.active) {
        if (!subscription.directories.has(directory)) continue
        try {
          subscription.listener(normalized)
        } catch {
          continue
        }
      }
    })
    try {
      await this.waitForReady(watcher)
    } catch (error) {
      try {
        await watcher.close()
        entry.watchers.delete(directory)
      } catch (closeError) {
        throw new AggregateError([error, closeError], 'Workspace watcher failed to start and close')
      }
      throw error
    }
    record.ready = true
    watcher.on('error', (error) => console.error('[workspace:watch]', error))
  }

  private waitForReady(watcher: FSWatcher): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error('Workspace watcher did not become ready')),
        WATCH_READY_TIMEOUT_MS
      )
      const onError = (error: unknown): void => finish(error)
      const onReady = (): void => finish()
      const finish = (error?: unknown): void => {
        clearTimeout(timeout)
        watcher.off('error', onError)
        watcher.off('ready', onReady)
        if (error === undefined) resolve()
        else reject(error)
      }
      watcher.once('error', onError)
      watcher.once('ready', onReady)
    })
  }
}

interface WatcherSubscription extends WorkspaceWatcherSubscription {
  active: boolean
  directories: Set<string>
  listener: ChangeListener
}

export const workspaceWatcherPool = new WorkspaceWatcherPool()
