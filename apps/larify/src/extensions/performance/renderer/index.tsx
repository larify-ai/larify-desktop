import type { Extension } from 'kernel'
import { performanceCollector } from './performance-store'

const extension: Extension = {
  activate(_host, context) {
    let disposed = false
    performanceCollector.initialize()
    const stopListening = window.bridge.on('performance:enable', () => {
      performanceCollector.start()
    })
    context.subscriptions.push({
      dispose: () => {
        disposed = true
        stopListening()
        performanceCollector.dispose()
      }
    })
    void window.bridge
      .invoke('performance:enabled')
      .then((enabled) => {
        if (!disposed && enabled) performanceCollector.start()
      })
      .catch(() => {})
  }
}

export default extension
