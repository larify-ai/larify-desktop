import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const registry = {
    addToolkit: vi.fn(),
    activeToolNames: vi.fn(() => ["agent_list_toolkit_tools"]),
    toolSet: vi.fn(() => ({ test_tool: {} })),
  }
  return {
    registry,
    buildSystemPrompt: vi.fn(() => "system prompt"),
    createAgentToolkit: vi.fn(() => ({ name: "agent", tools: {} })),
    createToolRegistry: vi.fn(() => registry),
    runAgent: vi.fn(),
    toolsContextFor: vi.fn((_tools, context) => ({ test_tool: context })),
  }
})

vi.mock("../../../../src/extensions/agent/main/agent", () => ({
  runAgent: mocks.runAgent,
  toolsContextFor: mocks.toolsContextFor,
}))

vi.mock("../../../../src/extensions/agent/main/agent-toolkit", () => ({
  createAgentToolkit: mocks.createAgentToolkit,
}))

vi.mock("../../../../src/extensions/agent/main/registry", () => ({
  createToolRegistry: mocks.createToolRegistry,
}))

vi.mock("../../../../src/extensions/agent/main/system-prompt", () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}))

import { exec } from "../../../../src/extensions/nest/loop/exec"

const app = {
  getAll: vi.fn(() => []),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registry.activeToolNames.mockReturnValue(["agent_list_toolkit_tools"])
  mocks.registry.toolSet.mockReturnValue({ test_tool: {} })
  mocks.createToolRegistry.mockReturnValue(mocks.registry)
  mocks.buildSystemPrompt.mockReturnValue("system prompt")
})

describe("nest loop exec", () => {
  it.each(["schedule", "terminate"] as const)(
    "returns the structured %s verdict",
    async (verdict) => {
      mocks.runAgent.mockReturnValue({
        output: Promise.resolve({ verdict }),
      })

      await expect(
        exec({
          app: app as never,
          cwd: "D:\\workspace",
          prompt: "loop prompt",
          sessionId: "parent-session",
        }),
      ).resolves.toBe(verdict)
    },
  )

  it("reuses the parent session for tool resources", async () => {
    mocks.runAgent.mockReturnValue({
      output: Promise.resolve({ verdict: "terminate" }),
    })

    await exec({
      app: app as never,
      cwd: "D:\\workspace",
      prompt: "loop prompt",
      sessionId: "parent-session",
    })

    expect(mocks.toolsContextFor).toHaveBeenCalledWith(
      { test_tool: {} },
      {
        cwd: "D:\\workspace",
        sessionId: "parent-session",
      },
    )
    expect(mocks.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "loop prompt" }],
        output: expect.anything(),
      }),
    )
  })

  it("propagates structured output failures", async () => {
    const error = new Error("invalid structured output")
    mocks.runAgent.mockReturnValue({
      output: Promise.reject(error),
    })

    await expect(
      exec({
        app: app as never,
        cwd: "D:\\workspace",
        prompt: "loop prompt",
        sessionId: "parent-session",
      }),
    ).rejects.toBe(error)
  })
})
