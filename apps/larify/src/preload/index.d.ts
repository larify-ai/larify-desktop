import type { Bridge, FileSystem } from './index'

declare global {
  interface Window {
    bridge: Bridge
    fs: FileSystem
  }
}
