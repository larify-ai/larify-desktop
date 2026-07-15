import type { Extension } from "kernel"
import { registerTerminalIpc } from "./ipc"
import { TerminalService } from "./terminal-service"

const extension: Extension = {
  activate(_app, context) {
    const service = new TerminalService()
    const unregisterIpc = registerTerminalIpc(service)
    context.subscriptions.push({
      dispose: () => {
        unregisterIpc()
        service.destroy()
      },
    })
  },
}

export default extension
