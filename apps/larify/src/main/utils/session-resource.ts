export interface SessionResource {
  destroySession(sessionId: string): void | Promise<void>
}
