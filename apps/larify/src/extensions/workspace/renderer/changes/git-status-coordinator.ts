import type { FileStatusResult } from 'simple-git'
import { gitClient } from '../git-client'
import { normalizeGitRoot } from './git-root'

const REFRESH_DELAY = 400

export interface GitStatusSnapshot {
  error?: string
  loading: boolean
  root: string
  statuses: FileStatusResult[]
}

interface Entry {
  error?: string
  ignoredConsumers: number
  includesIgnored: boolean
  listeners: Set<() => void>
  loaded: boolean
  queued: boolean
  root: string
  running: boolean
  statuses: FileStatusResult[]
  timer?: ReturnType<typeof setTimeout>
  totalConsumers: number
}

type FetchStatus = (root: string, includeIgnored: boolean) => Promise<FileStatusResult[]>

const isIgnored = ({ index, working_dir: workingDirectory }: FileStatusResult): boolean =>
  index === '!' && workingDirectory === '!'

export class GitStatusCoordinator {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly fetchStatus: FetchStatus = gitClient.status) {}

  activate(root: string, includeIgnored: boolean): () => void {
    const entry = this.entry(root)
    const resumed = entry.totalConsumers === 0 && entry.loaded
    entry.totalConsumers += 1
    if (includeIgnored) entry.ignoredConsumers += 1
    if (!entry.loaded || (includeIgnored && !entry.includesIgnored)) {
      queueMicrotask(() => {
        if (
          entry.totalConsumers > 0 &&
          (!entry.loaded || (entry.ignoredConsumers > 0 && !entry.includesIgnored))
        ) {
          this.run(entry)
        }
      })
    } else if (resumed) {
      this.request(entry, REFRESH_DELAY)
    }
    return () => {
      entry.totalConsumers = Math.max(0, entry.totalConsumers - 1)
      if (includeIgnored) entry.ignoredConsumers = Math.max(0, entry.ignoredConsumers - 1)
      if (entry.totalConsumers === 0) {
        clearTimeout(entry.timer)
        entry.timer = undefined
        entry.queued = false
      }
    }
  }

  refresh(root: string): void {
    this.request(this.entry(root), REFRESH_DELAY)
  }

  snapshot(root: string, includeIgnored: boolean): GitStatusSnapshot {
    const entry = this.entry(root)
    const loading = !entry.loaded || (includeIgnored && !entry.includesIgnored)
    return {
      ...(entry.error ? { error: entry.error } : {}),
      loading,
      root,
      statuses:
        includeIgnored || !entry.includesIgnored
          ? entry.statuses
          : entry.statuses.filter((status) => !isIgnored(status))
    }
  }

  subscribe(root: string, listener: () => void): () => void {
    const entry = this.entry(root)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  clear(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }

  private entry(root: string): Entry {
    const key = normalizeGitRoot(root)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        ignoredConsumers: 0,
        includesIgnored: false,
        listeners: new Set(),
        loaded: false,
        queued: false,
        root,
        running: false,
        statuses: [],
        totalConsumers: 0
      }
      this.entries.set(key, entry)
    }
    return entry
  }

  private notify(entry: Entry): void {
    for (const listener of entry.listeners) listener()
  }

  private request(entry: Entry, delay: number): void {
    if (entry.totalConsumers === 0) return
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => this.run(entry), delay)
  }

  private run(entry: Entry): void {
    if (entry.running) {
      entry.queued = true
      return
    }
    clearTimeout(entry.timer)
    entry.timer = undefined
    entry.running = true
    const includeIgnored = entry.ignoredConsumers > 0
    void this.fetchStatus(entry.root, includeIgnored)
      .then((statuses) => {
        entry.error = undefined
        entry.includesIgnored = includeIgnored
        entry.loaded = true
        entry.statuses = statuses
        this.notify(entry)
      })
      .catch((error) => {
        entry.error = error instanceof Error ? error.message : String(error)
        entry.includesIgnored = includeIgnored
        entry.loaded = true
        entry.statuses = []
        console.error('[workspace:git-status]', error)
        this.notify(entry)
      })
      .finally(() => {
        entry.running = false
        if (entry.queued) {
          entry.queued = false
          this.request(entry, REFRESH_DELAY)
        }
      })
  }
}

export const gitStatusCoordinator = new GitStatusCoordinator()
