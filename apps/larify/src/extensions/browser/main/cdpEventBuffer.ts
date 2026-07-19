export type CdpEvent = { method: string; params: unknown; sessionId?: string }

export class CdpEventBuffer {
  private events: CdpEvent[] = []
  private dropped = 0

  constructor(private readonly cap = 1000) {}

  push(event: CdpEvent): void {
    this.events.push(event)
    if (this.events.length > this.cap) {
      this.events.shift()
      this.dropped++
    }
  }

  drain(filter?: string): { events: CdpEvent[]; dropped: number } {
    const match = (e: CdpEvent): boolean => !filter || e.method.startsWith(filter)
    const events = this.events.filter(match)
    const dropped = this.dropped
    this.events = this.events.filter((e) => !match(e))
    this.dropped = 0
    return { events, dropped }
  }
}
