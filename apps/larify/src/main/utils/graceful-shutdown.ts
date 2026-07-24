export interface QuitEvent {
  preventDefault(): void
}

export interface QuitApp {
  on(event: "before-quit", listener: (event: QuitEvent) => void): void
  quit(): void
}

export function installGracefulShutdown(
  app: QuitApp,
  dispose: () => void | Promise<void>,
): void {
  let disposing = false
  let disposed = false

  app.on("before-quit", (event) => {
    if (disposed) return
    event.preventDefault()
    if (disposing) return
    disposing = true
    void Promise.resolve()
      .then(dispose)
      .catch((error) => console.error("[shutdown]", error))
      .finally(() => {
        disposed = true
        app.quit()
      })
  })
}
