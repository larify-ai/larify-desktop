import { app } from "electron"
import { createApp, Loader } from "kernel"
import type { Manifest } from "kernel"

const EXTENSIONS: Manifest[] = []

app.whenReady().then(async () => {
  const host = createApp()
  const loader = new Loader(host, (m) => import(`../extensions/${m.id}/main/index.js`))
  await loader.loadAll(EXTENSIONS)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
