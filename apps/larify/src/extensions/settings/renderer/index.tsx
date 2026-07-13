import type { Extension } from "kernel"
import type { View } from "@renderer/types/view"
import { SettingsPane } from "./components/settings-pane"

const extension: Extension = {
  activate(app) {
    app.register("view", "settings", { render: () => <SettingsPane /> } satisfies View)
  },
}

export default extension
