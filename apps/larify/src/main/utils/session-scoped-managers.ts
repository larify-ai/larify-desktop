export class SessionScopedManagers<T> {
  private readonly managers = new Map<string, T>()

  constructor(
    private readonly createManager: (sessionId: string) => T,
    private readonly destroyManager?: (manager: T) => void | Promise<void>,
  ) {}

  get(sessionId: string): T {
    let manager = this.managers.get(sessionId)
    if (!manager) {
      manager = this.createManager(sessionId)
      this.managers.set(sessionId, manager)
    }
    return manager
  }

  peek(sessionId: string): T | undefined {
    return this.managers.get(sessionId)
  }

  forEach(callback: (manager: T, sessionId: string) => void): void {
    this.managers.forEach(callback)
  }

  async destroySession(sessionId: string): Promise<void> {
    const manager = this.managers.get(sessionId)
    if (!manager) return
    this.managers.delete(sessionId)
    await this.destroyManager?.(manager)
  }

  async destroyAll(): Promise<void> {
    const managers = [...this.managers.values()]
    this.managers.clear()
    await Promise.all(managers.map((manager) => this.destroyManager?.(manager)))
  }
}
