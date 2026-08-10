import type { App } from 'electron'
import type { Registry } from '@shared/infra/registry'
import type { MainWindow } from '../window'

export interface Application {
  electron: App
  window: MainWindow
  registry: Registry
}
