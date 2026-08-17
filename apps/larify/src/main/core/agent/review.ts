import type { UIMessageChunk } from 'ai'
import { GitSnapshotService, type GitSnapshotPartData } from '../git/snapshot'

const updateDelay = 150
const reviewPartId = 'review'

export const reviewChunk = (data: GitSnapshotPartData | null): UIMessageChunk => ({
  type: 'data-git-snapshot',
  id: reviewPartId,
  data
})

export class AgentReview {
  private active = true
  private timer?: ReturnType<typeof setTimeout>
  private updating?: Promise<void>
  private pending = false
  private visible = false

  constructor(
    private readonly snapshots: GitSnapshotService,
    private readonly start: Awaited<ReturnType<GitSnapshotService['start']>>,
    private readonly emit: (chunk: UIMessageChunk) => void
  ) {}

  update(): void {
    if (!this.active) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.updating) {
        this.pending = true
        return
      }
      this.updating = this.compare().finally(() => {
        this.updating = undefined
        if (this.pending) {
          this.pending = false
          this.update()
        }
      })
    }, updateDelay)
  }

  async finish(): Promise<GitSnapshotPartData | null> {
    if (!this.active) return null
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = false
    await this.updating
    if (!this.active) return null
    const data = await this.snapshots.compare(this.start)
    if (!this.active) return null
    this.publish(data)
    return data
  }

  dispose(): void {
    this.active = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = false
  }

  private async compare(): Promise<void> {
    const data = await this.snapshots.compare(this.start)
    if (!this.active) return
    this.publish(data)
  }

  private publish(data: GitSnapshotPartData | null): void {
    if (!data && !this.visible) return
    this.visible = data !== null
    this.emit(reviewChunk(data))
  }
}
