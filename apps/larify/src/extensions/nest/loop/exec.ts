import { Output, type ModelMessage } from "ai"
import { z } from "zod"
import type { App } from "kernel"
import type { Toolkit } from "../../../shared/tool"
import { createAgentToolkit } from "../../agent/main/agent-toolkit"
import { runAgent, toolsContextFor } from "../../agent/main/agent"
import { createToolRegistry } from "../../agent/main/registry"
import { buildSystemPrompt } from "../../agent/main/system-prompt"
import { createSkillFactory, skillRoots } from "../../agent/main/skill-factory"

const verdictOutput = Output.object({
  schema: z.object({
    verdict: z.enum(["schedule", "terminate"]),
  }),
})

export interface ExecInput {
  app: App
  cwd: string
  prompt: string
  sessionId: string
  signal?: AbortSignal
}

export async function exec(input: ExecInput): Promise<"schedule" | "terminate"> {
  const skills = createSkillFactory(skillRoots())
  const registry = createToolRegistry(input.app.getAll<Toolkit>("tool"))
  registry.addToolkit(createAgentToolkit(registry, skills))
  const tools = registry.toolSet()
  const messages: ModelMessage[] = [{ role: "user", content: input.prompt }]
  const result = runAgent({
    messages,
    tools,
    activeTools: registry.activeToolNames(),
    toolsContext: toolsContextFor(tools, {
      sessionId: input.sessionId,
      cwd: input.cwd,
    }),
    abortSignal: input.signal,
    system: buildSystemPrompt(registry, input.cwd, skills),
    output: verdictOutput,
  })

  return (await result.output).verdict
}
