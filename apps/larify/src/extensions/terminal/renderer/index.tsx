import type { Extension } from "kernel"
import { SquareTerminalIcon } from "lucide-react"
import type { View } from "@renderer/types/view"
import { TerminalView } from "./terminal-view"

const extension: Extension = {
  activate(app) {
    app.register("view", "terminal", {
      sidebar: {
        icon: SquareTerminalIcon,
        id: "terminal",
        label: "终端",
        order: 10,
        placement: "content",
      },
      render: () => <TerminalView />,
    } satisfies View)
  },
}

export default extension
