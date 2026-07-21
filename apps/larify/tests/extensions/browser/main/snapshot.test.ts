import { describe, expect, it } from "vitest"
import { renderBuilt, type BuiltSnapshot, type Node } from "../../../../src/extensions/browser/main/snapshot"

function build(node: Partial<Node>): BuiltSnapshot {
  const full: Node = { role: "generic", name: "", children: [], hasRef: false, ...node }
  return { tree: [full], roots: [0] } as unknown as BuiltSnapshot
}

describe("renderBuilt value escaping", () => {
  it("keeps a multi-line textarea value on a single tree line", () => {
    const out = renderBuilt(build({ role: "textbox", name: "Comment", value: "line1\nline2" }))

    expect(out.split("\n")).toHaveLength(1)
    expect(out).toBe('- textbox "Comment": "line1\\nline2"')
  })

  it("renders a single-line value with JSON quoting, matching the name", () => {
    const out = renderBuilt(build({ role: "textbox", name: "Q", value: "hello" }))

    expect(out).toBe('- textbox "Q": "hello"')
  })
})
