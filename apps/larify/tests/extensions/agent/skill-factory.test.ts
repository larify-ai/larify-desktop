import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAgentToolkit } from "../../../src/extensions/agent/main/agent-toolkit"
import { createToolRegistry } from "../../../src/extensions/agent/main/registry"
import { createSkillFactory } from "../../../src/extensions/agent/main/skill-factory"
import { buildSystemPrompt } from "../../../src/extensions/agent/main/system-prompt"
import { larifyPath } from "../../../src/main/utils/app-paths"

const roots: string[] = []

function createRoot(): string {
  const root = join(process.cwd(), ".test-skills", crypto.randomUUID())
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

function writeSkill(
  root: string,
  directory: string,
  frontmatter: string,
  body = "# Instructions",
): string {
  const path = join(root, directory)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`)
  return path
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("createSkillFactory", () => {
  it("lists all skills and selects eager skills for the system prompt", () => {
    const root = createRoot()
    writeSkill(root, "grounding", "name: grounding\ndescription: Ground information.\neager: true")
    writeSkill(root, "review", "name: review\ndescription: Review changes.")

    const factory = createSkillFactory([root])

    expect(factory.eager()).toMatchObject([
      { name: "grounding", description: "Ground information.", eager: true },
    ])
    expect(factory.list()).toMatchObject([
      { name: "grounding", description: "Ground information.", eager: true },
      { name: "review", description: "Review changes.", eager: false },
    ])
    expect(factory.list()[1].path).toBe(join(root, "review", "SKILL.md"))
  })

  it("discovers SKILL.md files recursively and ignores other Markdown files", () => {
    const root = createRoot()
    writeSkill(root, join("embedded", "testing"), "name: hardware-testing\ndescription: Test hardware.")
    writeFileSync(join(root, "README.md"), "# Not a skill")

    expect(createSkillFactory([root]).list()).toMatchObject([
      { name: "hardware-testing", description: "Test hardware.", eager: false },
    ])
  })

  it("treats an omitted eager field as false", () => {
    const root = createRoot()
    writeSkill(root, "review", "name: review\ndescription: Review changes.")

    const [skill] = createSkillFactory([root]).list()

    expect(skill.eager).toBe(false)
  })

  it("lets later roots override skills with the same name", () => {
    const builtIn = createRoot()
    const project = createRoot()
    writeSkill(builtIn, "review", "name: review\ndescription: Built-in review.")
    writeSkill(project, "review", "name: review\ndescription: Project review.")

    const factory = createSkillFactory([builtIn, project])

    expect(factory.list()).toMatchObject([
      { name: "review", description: "Project review.", eager: false },
    ])
  })

  it("allows a later root to change whether an overridden skill is eager", () => {
    const builtIn = createRoot()
    const project = createRoot()
    writeSkill(builtIn, "review", "name: review\ndescription: Built-in review.\neager: true")
    writeSkill(project, "review", "name: review\ndescription: Project review.\neager: false")

    const factory = createSkillFactory([builtIn, project])

    expect(factory.eager()).toEqual([])
    expect(factory.list()).toMatchObject([{ name: "review", eager: false }])
  })

  it("ignores skill roots that do not exist", () => {
    const root = createRoot()
    const missing = join(root, "missing")

    expect(createSkillFactory([missing]).list()).toEqual([])
  })

  it.each([
    ["missing name", "description: Missing name.", "non-empty name"],
    ["empty name", 'name: ""\ndescription: Empty name.', "non-empty name"],
    ["missing description", "name: missing-description", "non-empty description"],
    [
      "invalid eager",
      "name: invalid\ndescription: Invalid eager.\neager: yes",
      "eager as a boolean",
    ],
  ])("skips %s without affecting valid skills", (_case, frontmatter, message) => {
    const root = createRoot()
    writeSkill(root, "invalid", frontmatter)
    writeSkill(root, "valid", "name: valid\ndescription: Valid skill.")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(createSkillFactory([root]).list()).toMatchObject([
      { name: "valid", description: "Valid skill." },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(message))
    warn.mockRestore()
  })

  it("exposes all skills and their eager state through agent_list_skills", async () => {
    const root = createRoot()
    writeSkill(root, "review", "name: review\ndescription: Review changes.\neager: false")
    writeSkill(root, "grounding", "name: grounding\ndescription: Ground information.\neager: true")
    const skills = createSkillFactory([root])
    const registry = createToolRegistry([])

    registry.addToolkit(createAgentToolkit(registry, skills))

    const listSkills = registry.tool("agent_list_skills")
    expect(listSkills).toBeDefined()
    expect(registry.activeToolNames()).toContain("agent_list_skills")

    const output = await listSkills!.execute!(
      { _title: "List skills" },
      {
        toolCallId: "test",
        messages: [],
        abortSignal: new AbortController().signal,
        context: { sessionId: "session", cwd: root },
      },
    )

    expect(output).toEqual([
      {
        name: "grounding",
        description: "Ground information.",
        eager: true,
        path: join(root, "grounding", "SKILL.md"),
      },
      {
        name: "review",
        description: "Review changes.",
        eager: false,
        path: join(root, "review", "SKILL.md"),
      },
    ])
  })

  it("returns an empty list when no skill factory is configured", async () => {
    const registry = createToolRegistry([])
    registry.addToolkit(createAgentToolkit(registry))
    const listSkills = registry.tool("agent_list_skills")!

    const output = await listSkills.execute!(
      { _title: "List skills" },
      {
        toolCallId: "test",
        messages: [],
        abortSignal: new AbortController().signal,
        context: { sessionId: "session", cwd: process.cwd() },
      },
    )

    expect(output).toEqual([])
  })

  it("writes only eager skills into the system prompt", () => {
    const root = createRoot()
    writeSkill(root, "context", "name: context\ndescription: Represent context.\neager: true")
    writeSkill(root, "review", "name: review\ndescription: Review changes.\neager: false")
    const skills = createSkillFactory([root])

    const prompt = buildSystemPrompt(createToolRegistry([]), root, skills)

    expect(prompt).toContain(
      `- \`context\`: Represent context. (\`${join(root, "context", "SKILL.md")}\`)`,
    )
    expect(prompt).not.toContain("Review changes.")
    expect(prompt).toContain(`The context directory is \`${larifyPath("context")}\`.`)
    expect(prompt).toContain(`The task directory is \`${larifyPath("tasks")}\`.`)
    expect(prompt).toContain(
      "Some available skills are listed below. To see more, first list skills with `agent_list_skills`, then read content with `fs_read`.",
    )
  })

})
