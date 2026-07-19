import { app, screen, shell, ipcMain, nativeTheme, BrowserWindow, dialog } from "electron"
import { join } from "path"
import { is } from "@electron-toolkit/utils"
import type { Extension } from "kernel"

const isMac = process.platform === "darwin"

function createWindow(): BrowserWindow {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(1280, workArea.width - 80)
  const height = Math.min(800, workArea.height - 80)
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    show: false,
    title: "Larify",
    titleBarStyle: "hidden",
    ...(isMac
      ? {}
      : { titleBarOverlay: { color: "rgba(0,0,0,0)", symbolColor: "#fafafa", height: 40 } }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  })

  win.on("ready-to-show", () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return win
}

const extension: Extension = {
  activate(appHost, context) {
    const win = createWindow()
    context.subscriptions.push(appHost.register("service", "main-window", { get: () => win }))
    context.subscriptions.push({ dispose: () => win.destroy() })

    ipcMain.handle("theme:set", (_e, theme) => {
      if (theme === "light" || theme === "dark" || theme === "system") {
        nativeTheme.themeSource = theme
      }
    })
    ipcMain.handle("titlebar:set-symbol", (event, symbolColor) => {
      if (isMac || typeof symbolColor !== "string") return
      BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({
        color: "rgba(0,0,0,0)",
        symbolColor,
        height: 40,
      })
    })
    ipcMain.handle("dialog:pick-directories", async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? win
      const result = await dialog.showOpenDialog(owner, {
        properties: ["openDirectory", "multiSelections"],
      })
      return result.canceled ? [] : result.filePaths
    })
    context.subscriptions.push({
      dispose: () => {
        ipcMain.removeHandler("theme:set")
        ipcMain.removeHandler("titlebar:set-symbol")
        ipcMain.removeHandler("dialog:pick-directories")
      },
    })

    const onActivate = (): void => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    }
    app.on("activate", onActivate)
    context.subscriptions.push({
      dispose: () => {
        app.removeListener("activate", onActivate)
      },
    })
  },
}

export default extension
