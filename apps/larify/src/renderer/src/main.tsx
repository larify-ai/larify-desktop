import "./assets/main.css"
import { createRoot } from "react-dom/client"
import type { ReactNode } from "react"
import { createApp, Loader } from "kernel"
import type { Extension, Manifest } from "kernel"

const manifests = import.meta.glob<{ default: Manifest }>("../../extensions/*/manifest.json", {
  eager: true,
})
const modules = import.meta.glob<{ default: Extension }>("../../extensions/*/renderer/index.tsx")

const EXTENSIONS = Object.values(manifests).map((m) => m.default)

interface RootView {
  render(): ReactNode
}

async function boot(): Promise<void> {
  const host = createApp()
  const loader = new Loader(host, (m) => modules[`../../extensions/${m.id}/renderer/index.tsx`]())
  await loader.loadAll(EXTENSIONS)

  const root = createRoot(document.getElementById("root")!)
  const view = host.get<RootView>("view", "root")
  root.render(view?.render())
}

boot()
