import type { Plugin } from '../../../main/core/plugin/protocol'
import { readFileTool } from './read'
import { readImageTool } from './read-image'
import { editFileTool } from './edit'
import { globFilesTool } from './glob'
import { grepFilesTool } from './grep'
import { lsTool } from './ls'
import { writeFileTool } from './write'

const plugin: Plugin = {
  manifest: {
    id: 'fs',
    description: 'Read text and image files, edit, write, list, glob, and grep files'
  },
  activate(context) {
    context.registerTool('read', readFileTool)
    context.registerTool('read_image', readImageTool)
    context.registerTool('edit', editFileTool)
    context.registerTool('write', writeFileTool)
    context.registerTool('list', lsTool)
    context.registerTool('glob', globFilesTool)
    context.registerTool('grep', grepFilesTool)
  }
}

export default plugin
