import type { Extension } from '@shared/extension'
import { readFileTool } from './read'
import { editFileTool } from './edit'
import { globFilesTool } from './glob'
import { grepFilesTool } from './grep'
import { lsTool } from './ls'
import { writeFileTool } from './write'

const extension: Extension = {
  name: 'fs',
  description: 'Read, edit, write, list, glob, and grep files',
  activate(app) {
    app.registerTool('read', readFileTool)
    app.registerTool('edit', editFileTool)
    app.registerTool('write', writeFileTool)
    app.registerTool('list', lsTool)
    app.registerTool('glob', globFilesTool)
    app.registerTool('grep', grepFilesTool)
  }
}

export default extension
