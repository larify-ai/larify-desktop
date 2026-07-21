import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { readFileTool } from "./read"
import { editFileTool } from "./edit"
import { globFilesTool } from "./glob"
import { grepFilesTool } from "./grep"
import { lsTool } from "./ls"
import { writeFileTool } from "./write"

const fileToolkit: Toolkit = {
  name: "fs",
  description: "Read, edit, write, list, glob, and grep files",
  tools: {
    read: readFileTool,
    edit: editFileTool,
    write: writeFileTool,
    ls: lsTool,
    glob: globFilesTool,
    grep: grepFilesTool,
  },
}

const extension: Extension = {
  activate(app, context) {
    context.subscriptions.push(app.register("tool", "file", fileToolkit))
  },
}

export default extension
