export class FrameSessions {
  private readonly map = new Map<string, string>()

  attached(params: unknown): string | undefined {
    const p = params as { sessionId?: string; targetInfo?: { targetId?: string; type?: string } }
    const sid = p.sessionId
    const info = p.targetInfo
    if (info?.type === 'iframe' && typeof info.targetId === 'string' && sid) {
      this.map.set(info.targetId, sid)
      return sid
    }
    return undefined
  }

  detached(params: unknown): void {
    const sid = (params as { sessionId?: string }).sessionId
    if (!sid) return
    for (const [frameId, s] of this.map) if (s === sid) this.map.delete(frameId)
  }

  get(frameId: string): string | undefined {
    return this.map.get(frameId)
  }

  asMap(): Map<string, string> {
    return this.map
  }

  clear(): void {
    this.map.clear()
  }
}
