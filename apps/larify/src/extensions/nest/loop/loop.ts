import type { App } from "kernel"
import { get, set } from "../utils/frontmatter"
import { renderPrompt } from "../utils/prompt"
import { childTaskFiles, parentTaskFile } from "../utils/task"
import promptTemplate from "./prompt.md?raw"
import { exec } from "./exec"

export interface LoopInput {
  app: App
  cwd: string
  rootTaskFile: string
  sessionId: string
  signal?: AbortSignal
}

export async function runLoop(input: LoopInput): Promise<void> {
  async function runTask(taskFile: string): Promise<void> {
    while (!input.signal?.aborted && get(taskFile, "status") !== "done") {
      const children = childTaskFiles(taskFile).filter(
        (file) => get(file, "status") !== "done",
      )

      if (children.length > 0) {
        await Promise.allSettled(children.map(runTask))
        continue
      }

      const verdict = await exec({
        app: input.app,
        cwd: input.cwd,
        sessionId: input.sessionId,
        signal: input.signal,
        prompt: renderPrompt(promptTemplate, {
          cwd: input.cwd,
          current_task_path: taskFile,
          upper_task_path: parentTaskFile(taskFile, input.rootTaskFile),
        }),
      })

      if (verdict === "terminate") {
        set(taskFile, "status", "done")
      }
    }
  }

  await runTask(input.rootTaskFile)
}
