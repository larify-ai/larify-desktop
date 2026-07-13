import type { Extension } from "kernel"
import { Shell } from "./components/shell"

const extension: Extension = {
  activate(app) {
    app.register("view", "root", { render: () => <Shell app={app} /> })
  },
}

export default extension
