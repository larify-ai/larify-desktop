import { app } from "electron"
import { electronApp, optimizer } from "@electron-toolkit/utils"
import { createApp, Loader } from "kernel"
import type { Extension } from "kernel"
import { discoverExtensions } from "../shared/discover-extensions"
import { installGracefulShutdown } from "./utils/graceful-shutdown"

const modules = import.meta.glob<{ default: Extension }>("../extensions/*/main/index.ts")
const { extensions, loaders } = discoverExtensions(modules)

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-features", "MacWebContentsOcclusion")
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("ai.larify.app")
  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window))

  const host = createApp()
  const loader = new Loader(host, (m) => loaders.get(m.id)!())
  await loader.loadAll(extensions)

  installGracefulShutdown(app, () => loader.unloadAll())
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
