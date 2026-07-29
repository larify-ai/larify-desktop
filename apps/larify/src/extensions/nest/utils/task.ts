import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"

export function childTaskFiles(taskFile: string): string[] {
  const directory = dirname(taskFile)
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(directory, entry.name, "task.md")),
    )
    .map((entry) => join(directory, entry.name, "task.md"))
    .sort()
}

export function parentTaskFile(
  taskFile: string,
  rootTaskFile: string,
): string | undefined {
  if (taskFile === rootTaskFile) return undefined
  const parentFile = join(dirname(dirname(taskFile)), "task.md")
  return existsSync(parentFile) ? parentFile : undefined
}
