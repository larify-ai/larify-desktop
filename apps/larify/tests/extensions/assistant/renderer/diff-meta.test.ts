import { describe, expect, it } from "vitest"
import { asDiffMeta, toolCall, toolIcon } from "../../../../src/extensions/assistant/renderer/lib/diff-meta"

describe("asDiffMeta 从工具输出里认出 diff 元数据", () => {
  it("认出 edit/write 返回的 kind:diff 对象", () => {
    const output = {
      kind: "diff",
      path: "/a.ts",
      patch: "@@ -1 +1 @@\n-a\n+b",
      oldContent: "a\n",
      newContent: "b\n",
      summary: "Edited /a.ts.",
    }

    expect(asDiffMeta(output)).toBe(output)
  })

  it("普通工具的字符串输出不是 diff", () => {
    expect(asDiffMeta("Closed terminal 1.")).toBeNull()
  })

  it("其它结构化输出不是 diff", () => {
    expect(asDiffMeta({ terminals: [] })).toBeNull()
    expect(asDiffMeta({ kind: "clickable" })).toBeNull()
    expect(asDiffMeta({ kind: "diff" })).toBeNull()
    expect(asDiffMeta({ kind: "diff", path: "/a.ts", patch: 1 })).toBeNull()
  })

  it("空值不是 diff", () => {
    expect(asDiffMeta(undefined)).toBeNull()
    expect(asDiffMeta(null)).toBeNull()
  })
})

describe("toolIcon 从工具 metadata 里取图标名", () => {
  it("读出 metadata 里的 icon", () => {
    expect(toolIcon({ icon: "edit" })).toBe("edit")
  })

  it("没有 metadata 或没有 icon 时给 undefined", () => {
    expect(toolIcon(undefined)).toBeUndefined()
    expect(toolIcon(null)).toBeUndefined()
    expect(toolIcon({})).toBeUndefined()
  })

  it("icon 不是字符串时也给 undefined", () => {
    expect(toolIcon({ icon: 123 })).toBeUndefined()
  })
})

describe("toolCall 从 {title, args} 包装里拆出标题和真实参数", () => {
  it("拆出模型给的 title 和内层 args", () => {
    const input = { _title: "读取 hello.txt 内容", file_path: "/a.txt", limit: 50000 }

    expect(toolCall(input)).toEqual({ title: "读取 hello.txt 内容", args: { file_path: "/a.txt", limit: 50000 } })
  })

  it("title 缺失或非字符串时只给 args, 不带 title 字段", () => {
    expect(toolCall({ x: 1 })).toEqual({ args: { x: 1 } })
    expect(toolCall({ _title: 123, x: 1 })).toEqual({ args: { x: 1 } })
  })

  it("没有 args 包装时把整个输入当参数", () => {
    expect(toolCall({ file_path: "/a.txt" })).toEqual({ args: { file_path: "/a.txt" } })
  })

  it("从扁平输入中拆出 title 和参数", () => {
    expect(toolCall({ _title: "读取文件", file_path: "/a.txt" })).toEqual({
      title: "读取文件",
      args: { file_path: "/a.txt" },
    })
  })

  it("流式途中输入还没到时不抛错", () => {
    expect(toolCall(undefined)).toEqual({ args: undefined })
    expect(toolCall(null)).toEqual({ args: null })
  })
})
