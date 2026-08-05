import { defineService, type Extension } from '@shared/extension'
import { GitService } from './git-service'

export const gitService = defineService<GitService>('git')

const extension: Extension = {
  name: 'git',
  description: 'Provide Git operations.',
  activate(app) {
    app.registerService(gitService, new GitService())
  }
}

export default extension
