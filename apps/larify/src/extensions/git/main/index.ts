import type { Extension } from '@shared/extension'
import { GitService } from './git-service'

const extension: Extension = {
  activate(app) {
    app.register('service', 'git', new GitService())
  }
}

export default extension
