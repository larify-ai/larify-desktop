import type { Extension } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { readFileTool } from "./read"
import { editFileTool } from "./edit"
import { writeFileTool } from "./write"

const fileKit: Toolkit = {
  name: "filesystem",
  description: "Read, write files",
  tools: [readFileTool, editFileTool, writeFileTool],
}

const extension: Extension = {
  activate(app, context) {
    context.subscriptions.push(app.register("tool", "file", fileKit))
  },
}

export default extension
