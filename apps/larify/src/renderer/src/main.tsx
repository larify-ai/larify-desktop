import "./assets/main.css"
import { createRoot } from "react-dom/client"
import { createApp, Loader } from "kernel"
import type { Extension } from "kernel"
import type { View } from "@renderer/types/view"
import { discoverExtensions } from "../../shared/discover-extensions"

const modules = import.meta.glob<{ default: Extension }>("../../extensions/*/renderer/index.tsx")
const { extensions, loaders } = discoverExtensions(modules)

async function boot(): Promise<void> {
  const host = createApp()
  const loader = new Loader(host, (m) => loaders.get(m.id)!())
  await loader.loadAll(extensions)

  const root = createRoot(document.getElementById("root")!)
  const view = host.get<View>("view", "root")
  root.render(view?.render())
}

boot()

document.addEventListener("mousedown", (e) => {
  const target = e.target as Element | null
  if (!target?.closest?.(".select-text")) {
    window.getSelection()?.removeAllRanges()
  }
})
