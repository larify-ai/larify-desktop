import { createTwoFilesPatch } from "diff"
import { describe, expect, it } from "vitest"
import { diffContentsForView } from "../../../../src/extensions/assistant/renderer/lib/diff-content"

describe("diffContentsForView", () => {
  it("keeps content when the patch applies to the same new content", () => {
    const oldContent = "a\nb\nc\n"
    const newContent = "a\nB\nc\n"
    const patch = createTwoFilesPatch("file.txt", "file.txt", oldContent, newContent, "", "", {
      context: 3,
    })

    expect(diffContentsForView({ oldContent, newContent, patch })).toEqual({
      oldContent,
      newContent,
    })
  })

  it("omits content when it does not match the patch", () => {
    const oldContent = "a\nb\nc\n"
    const newContent = "a\nB\nc\n"
    const patch = createTwoFilesPatch("file.txt", "file.txt", oldContent, newContent, "", "", {
      context: 3,
    })

    expect(diffContentsForView({ oldContent, newContent: "changed elsewhere\n", patch })).toBeNull()
  })
})
