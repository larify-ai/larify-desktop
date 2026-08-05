import type { Extension } from '../../../shared/types'
import template from './prompt.md?raw'
import { registerRunHandlers } from './runner'
import { registerSessionHandlers } from './sessions'

const extension: Extension = {
  activate(app, context) {
    context.subscriptions.push(registerSessionHandlers(app), registerRunHandlers(app, template))
  }
}

export default extension
