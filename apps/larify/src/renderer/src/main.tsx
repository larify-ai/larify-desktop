import { createRoot } from "react-dom/client"
import type { ReactNode } from "react"
import { createApp, Loader } from "kernel"
import type { Manifest } from "kernel"

const EXTENSIONS: Manifest[] = []

interface RootView {
  render(): ReactNode
}

async function boot(): Promise<void> {
  const host = createApp()
  const loader = new Loader(host, (m) => import(`../../extensions/${m.id}/renderer/index.js`))
  await loader.loadAll(EXTENSIONS)

  const root = createRoot(document.getElementById("root")!)
  const view = host.getAll<RootView>("view")[0]
  root.render(view?.render())
}

boot()
