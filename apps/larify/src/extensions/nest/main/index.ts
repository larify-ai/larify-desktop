import type { Extension } from 'kernel'
import { larifyPath } from '../../../main/utils/app-paths'
import { registerFileDiagnosticsProvider } from '../../file/main/diagnostics'
import { createTaskDiagnosticsProvider } from './diagnostics'

const extension: Extension = {
  activate(_app, context) {
    const dispose = registerFileDiagnosticsProvider(
      createTaskDiagnosticsProvider(larifyPath('tasks'))
    )
    context.subscriptions.push({ dispose })
  }
}

export default extension
