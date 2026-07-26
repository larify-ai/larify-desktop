import { GlobeIcon } from "lucide-react"
import type { Extension } from "kernel"
import type { View } from "@renderer/types/view"
import { BrowserView } from "./browser-view"

const extension: Extension = {
  activate(app) {
    app.register("view", "browser", {
      sidebar: { icon: GlobeIcon, id: "browser", label: "浏览", order: 8, placement: "content" },
      render: () => <BrowserView />,
    } satisfies View)
  },
}

export default extension
