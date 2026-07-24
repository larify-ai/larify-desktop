import { app, BrowserWindow } from "electron"
import { resolve } from "node:path"
import { Recorder } from "../../../../src/extensions/browser/main/recorder"

async function main(): Promise<void> {
  await app.whenReady()

  const page = new BrowserWindow({ show: false, width: 640, height: 480 })
  await page.loadURL(
    `data:text/html,${encodeURIComponent("<style>body{font:32px sans-serif;background:white} </style>Static recording")}`,
  )
  page.webContents.debugger.attach("1.3")

  const output = resolve(process.argv[2] ?? "recorder-framerate.webm")
  const recorder = new Recorder()
  const tab = {
    id: 1,
    view: { webContents: page.webContents },
    sendCdp: (method: string, params?: object) =>
      page.webContents.debugger.sendCommand(method, params),
  }

  try {
    await recorder.start(tab as never, output)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
    const result = await recorder.stop()
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await recorder.destroy()
    if (!page.isDestroyed()) page.destroy()
    app.quit()
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  app.exit(1)
})
