// @vitest-environment jsdom

import { createElement, Fragment, memo, useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UIMessage } from "ai"
import { MessageView } from "../../../../src/extensions/assistant/renderer/components/message-view"
import { Tool, ToolContent } from "../../../../src/renderer/src/components/ai-elements/tool"

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
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
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
})
