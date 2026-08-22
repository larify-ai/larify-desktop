export const loadChangesView = (): Promise<typeof import('./changes-view')> =>
  import('./changes-view')

export const loadMonacoDiff = (): Promise<typeof import('./monaco-diff')> => import('./monaco-diff')

export const preloadChangesEditor = (): Promise<unknown> =>
  Promise.all([loadChangesView(), loadMonacoDiff()])
