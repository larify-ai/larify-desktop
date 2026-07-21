import { describe, expect, it } from "vitest"
import {
  buildSnapshot,
  renderBuilt,
  type AXNode,
  type BuiltSnapshot,
  type Node,
  type RefEntry,
} from "../../../../src/extensions/browser/main/snapshot"

function build(node: Partial<Node>): BuiltSnapshot {
  const full: Node = { role: "generic", name: "", children: [], hasRef: false, ...node }
  return { tree: [full], roots: [0] } as unknown as BuiltSnapshot
}

const ax = (value: string): never => ({ value }) as never

function axNode(nodeId: string, role: string, name: string, extra: Partial<AXNode> = {}): AXNode {
  return { nodeId, ignored: false, role: ax(role), name: ax(name), ...extra } as AXNode
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

describe("buildSnapshot ref tagging", () => {
  it("assigns sequential refs, dedups nth per role+name, and records iframes and links", () => {
    const nodes: AXNode[] = [
      axNode("1", "RootWebArea", "", { childIds: ["2", "3", "4", "5"] }),
      axNode("2", "button", "Go", { backendDOMNodeId: 102 }),
      axNode("3", "link", "Home", { backendDOMNodeId: 103 }),
      axNode("4", "link", "Home", { backendDOMNodeId: 104 }),
      axNode("5", "Iframe", "ad", { backendDOMNodeId: 105 }),
    ]
    const refMap = new Map<string, RefEntry>()

    const built = buildSnapshot(nodes, refMap, 1)

    expect(built.nextRef).toBe(5)
    expect([...refMap.keys()]).toEqual(["e1", "e2", "e3", "e4"])
    expect(refMap.get("e1")).toMatchObject({ role: "button", name: "Go", nth: undefined })
    expect(refMap.get("e2")).toMatchObject({ role: "link", name: "Home", nth: 0 })
    expect(refMap.get("e3")).toMatchObject({ role: "link", name: "Home", nth: 1 })

    expect(built.iframes).toEqual([{ refId: "e4", backendNodeId: 105 }])
    expect(built.links).toEqual([
      { refId: "e2", backendNodeId: 103 },
      { refId: "e3", backendNodeId: 104 },
    ])

    const text = renderBuilt(built)
    expect(text).toContain('- button "Go" [ref=e1]')
    expect(text).toContain('- link "Home" [ref=e2]')
    expect(text).toContain('- Iframe "ad" [ref=e4]')
  })

  it("throws when a selector subtree matches no accessibility node", () => {
    const nodes: AXNode[] = [
      axNode("1", "RootWebArea", "", { childIds: ["2"] }),
      axNode("2", "button", "Go", { backendDOMNodeId: 102 }),
    ]

    expect(() => buildSnapshot(nodes, new Map(), 1, undefined, new Set([999]))).toThrow(
      "selector matched no accessibility node",
    )
  })
})
