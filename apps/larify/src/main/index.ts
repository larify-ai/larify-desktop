import { app } from 'electron'
import { bootstrap } from './app'

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion')
}

void app.whenReady().then(() => bootstrap(app))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
