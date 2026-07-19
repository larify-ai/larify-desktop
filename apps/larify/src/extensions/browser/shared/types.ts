export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTabError {
  code: number
  description: string
}

export interface BrowserTabState {
  id: number
  url: string
  title: string
  favIconUrl: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: BrowserTabError | null
}

export interface BrowserState {
  tabs: BrowserTabState[]
  activeId: number | null
}
