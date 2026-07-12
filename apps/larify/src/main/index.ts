import { app } from "electron"
import { electronApp, optimizer } from "@electron-toolkit/utils"
import { createApp, Loader } from "kernel"
import type { Extension, Manifest } from "kernel"

const manifests = import.meta.glob<{ default: Manifest }>("../extensions/*/manifest.json", {
  eager: true,
})
const modules = import.meta.glob<{ default: Extension }>("../extensions/*/main/index.ts")

const EXTENSIONS = Object.values(manifests).map((m) => m.default)

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-features", "MacWebContentsOcclusion")
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("ai.larify.app")
  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window))

  const host = createApp()
  const loader = new Loader(host, (m) => modules[`../extensions/${m.id}/main/index.ts`]())
  await loader.loadAll(EXTENSIONS)

  app.on("before-quit", () => void loader.unloadAll())
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
