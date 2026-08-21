// @vitest-environment jsdom

import { createElement, Fragment, memo, useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UIMessage } from "ai"

const codePlugin = vi.hoisted(() => ({
  highlight: vi.fn(),
  idleCallback: null as IdleRequestCallback | null,
}))

vi.mock("@streamdown/code", () => ({
  code: {
    name: "shiki",
    type: "code-highlighter",
    getSupportedLanguages: () => ["text"],
    getThemes: () => ["github-light", "github-dark"],
    highlight: codePlugin.highlight,
    supportsLanguage: () => true,
  },
}))

import { MessageView } from "../../../../src/renderer/src/app/interaction/assistant/message-view"
import {
  MessageBranch,
  MessageBranchContent,
  MessageResponse,
} from "../../../../src/renderer/src/components/ai-elements/message"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from "../../../../src/renderer/src/components/ai-elements/tool"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const oldMessage: UIMessage = {
  id: "old",
  role: "assistant",
  parts: [{ type: "text", text: "old message" }],
}

const liveMessage = (text: string): UIMessage => ({
  id: "live",
  role: "assistant",
  parts: [{ type: "text", text }],
})

describe("message rendering performance guards", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    codePlugin.highlight.mockClear()
    codePlugin.idleCallback = null
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      codePlugin.idleCallback = callback
      return 1
    })
    vi.stubGlobal("cancelIdleCallback", vi.fn())
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("keeps the global syntax-highlighter preload after the scheduling response unmounts", async () => {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MessageResponse, { key: "scheduler" }, "hello"),
          createElement(MessageResponse, { key: "remaining" }, "world"),
        ),
      ),
    )

    expect(codePlugin.highlight).not.toHaveBeenCalled()
    expect(codePlugin.idleCallback).not.toBeNull()

    await act(async () =>
      root.render(createElement(MessageResponse, { key: "remaining" }, "world")),
    )

    expect(cancelIdleCallback).not.toHaveBeenCalled()

    await act(async () => codePlugin.idleCallback?.({ didTimeout: false, timeRemaining: () => 10 }))

    expect(codePlugin.highlight).toHaveBeenCalledWith({
      code: "",
      language: "typescript",
      themes: ["github-light", "github-dark"],
    })
  })

  it("updates response props that are not part of the markdown content", async () => {
    await act(async () =>
      root.render(createElement(MessageResponse, { className: "before" }, "hello")),
    )
    expect(container.querySelector('.before')).not.toBeNull()

    await act(async () =>
      root.render(createElement(MessageResponse, { className: "after" }, "hello")),
    )

    expect(container.querySelector('.before')).toBeNull()
    expect(container.querySelector('.after')).not.toBeNull()
  })

  it("skips committing unchanged old messages when wrapped with React.memo", async () => {
    const oldRender = vi.fn(MessageView)
    const liveRender = vi.fn(MessageView)
    const MemoizedOldMessageView = memo(oldRender)
    const MemoizedLiveMessageView = memo(liveRender)

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MemoizedOldMessageView, { message: oldMessage }),
          createElement(MemoizedLiveMessageView, {
            message: liveMessage("first"),
            streaming: true,
          }),
        ),
      )
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    })

    expect(oldRender).toHaveBeenCalledTimes(1)
    expect(liveRender).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MemoizedOldMessageView, { message: oldMessage }),
          createElement(MemoizedLiveMessageView, {
            message: liveMessage("first second"),
            streaming: true,
          }),
        ),
      )
    })

    expect(oldRender).toHaveBeenCalledTimes(1)
    expect(liveRender).toHaveBeenCalledTimes(2)
  })

  it("does not mount tool content children while the tool card is collapsed", async () => {
    const mount = vi.fn()

    function ExpensiveChild(): React.JSX.Element {
      useEffect(mount, [])
      return createElement("div", null, "expensive output")
    }

    await act(async () => {
      root.render(
        createElement(
          Tool,
          { open: false },
          createElement(ToolContent, null, createElement(ExpensiveChild)),
        ),
      )
    })

    expect(container.textContent).not.toContain("expensive output")
    expect(mount).not.toHaveBeenCalled()
    expect(
      container.querySelector('.text-popover-foreground')?.getAttribute('data-state'),
    ).toBe('closed')

    await act(async () => {
      root.render(
        createElement(
          Tool,
          { open: true },
          createElement(ToolContent, null, createElement(ExpensiveChild)),
        ),
      )
    })

    expect(container.textContent).toContain("expensive output")
    expect(mount).toHaveBeenCalledTimes(1)
  })

  it("keeps an uncontrolled tool interactive when observing open changes", async () => {
    const onOpenChange = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          Tool,
          { onOpenChange },
          createElement(ToolHeader, {
            state: "output-available",
            title: "Tool",
            type: "tool-test",
          }),
          createElement(ToolContent, null, "tool output"),
        ),
      )
    })

    expect(container.textContent).not.toContain("tool output")

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click()
    })

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(container.textContent).toContain("tool output")
  })

  it.each([
    [false, "false"],
    [0, "0"],
  ])("renders falsy tool output %s", async (output, expected) => {
    await act(async () => {
      root.render(
        createElement(ToolOutput, {
          errorText: undefined,
          output,
        }),
      )
    })

    expect(container.textContent).toContain("结果")
    expect(container.textContent).toContain(expected)
  })

  it("normalizes non-element and empty message branches", async () => {
    await act(async () => {
      root.render(
        createElement(
          MessageBranch,
          null,
          createElement(MessageBranchContent, null, null, "plain text"),
        ),
      )
    })

    expect(container.textContent).toBe("plain text")
  })

  it("selects the last available branch when the active branch is removed", async () => {
    const renderBranches = async (count: number): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            MessageBranch,
            { defaultBranch: 1 },
            createElement(
              MessageBranchContent,
              null,
              ...Array.from({ length: count }, (_, index) =>
                createElement("span", { key: index }, `branch ${index}`),
              ),
            ),
          ),
        )
      })
    }

    await renderBranches(2)
    expect(container.textContent).toContain("branch 1")

    await renderBranches(1)
    expect(container.querySelector(".block")?.textContent).toBe("branch 0")
  })
})
