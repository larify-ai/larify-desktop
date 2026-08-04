import type { Extension } from "@shared/extension"
import type { View } from "@renderer/types/view"
import { AssistantPanel } from "./components/assistant-panel"

const extension: Extension = {
  activate(app) {
    app.register("view", "assistant", { render: () => <AssistantPanel /> } satisfies View)
  },
}

export default extension
