import { app } from "electron"
import { createApp, Loader } from "kernel"
import type { Extension, Manifest } from "kernel"

const manifests = import.meta.glob<{ default: Manifest }>("../extensions/*/manifest.json", {
  eager: true,
})
const modules = import.meta.glob<{ default: Extension }>("../extensions/*/main/index.ts")

const EXTENSIONS = Object.values(manifests).map((m) => m.default)

app.whenReady().then(async () => {
  const host = createApp()
  const loader = new Loader(host, (m) => modules[`../extensions/${m.id}/main/index.ts`]())
  await loader.loadAll(EXTENSIONS)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
