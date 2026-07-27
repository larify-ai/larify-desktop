type Theme = 'dark' | 'light'

export const workspaceEditorClient = {
  prepare: (root: string) =>
    window.bridge.invoke('workspace-editor:command', { type: 'prepare', root }),
  open: (root: string, file: string) =>
    window.bridge.invoke('workspace-editor:command', { type: 'open', root, file }),
  theme: (theme: Theme) =>
    window.bridge.invoke('workspace-editor:command', { type: 'theme', theme }),
  state: () =>
    window.bridge.invoke('workspace-editor:state') as Promise<{ activeFile: string | null }>,
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    window.bridge.invoke('workspace-editor:set-bounds', bounds),
  setVisible: (visible: boolean) => window.bridge.invoke('workspace-editor:set-visible', visible),
  onActive: (listener: (file: string | null) => void) =>
    window.bridge.on('workspace-editor:active', (file) => listener(file as string | null)),
  onReveal: (listener: (path: string) => void) =>
    window.bridge.on('workspace-editor:reveal', (path) => listener(path as string))
}
