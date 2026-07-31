import type { Extension } from 'kernel'
import { watch } from 'chokidar'
import { larifyPath } from '../../../main/utils/app-paths'
import { createContextDiagnosticsProvider } from './diagnostics'
import { isMarkdown } from './files'
import { buildContextGraph, updateContext } from './indexer'
import { registerFileDiagnosticsProvider } from '../../file/main/diagnostics'

const extension: Extension = {
  activate(_app, context) {
    const dispose = registerFileDiagnosticsProvider(createContextDiagnosticsProvider())
    const root = larifyPath('context')
    const graph = buildContextGraph(root)
    const watcher = watch(root, { ignoreInitial: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set<string>()
    watcher.on('all', (_event, file) => {
      if (!isMarkdown(file)) return
      pending.add(file)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const files = [...pending]
        pending.clear()
        updateContext(root, files, graph)
      }, 100)
    })

    context.subscriptions.push({
      dispose() {
        dispose()
        clearTimeout(timer)
        void watcher.close()
        graph.close()
      }
    })
  }
}

export default extension
