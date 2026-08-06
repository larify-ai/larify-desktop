import type { BrowserWindow } from 'electron'
import type { Disposable } from '../infra/disposable'

export interface MainWindow extends Disposable {
  get(): BrowserWindow
}
