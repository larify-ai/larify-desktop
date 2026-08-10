import type { BrowserWindow } from 'electron'
import type { Disposable } from '@shared/infra/disposable'

export interface MainWindow extends Disposable {
  get(): BrowserWindow
}
