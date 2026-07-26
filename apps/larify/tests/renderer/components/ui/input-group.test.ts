// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "../../../../src/renderer/src/components/ui/input-group"

describe("InputGroupAddon", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each([
    ["input", InputGroupInput],
    ["textarea", InputGroupTextarea],
  ])("focuses its %s while preserving the caller click handler", async (_, Control) => {
    const onClick = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          InputGroup,
          null,
          createElement(InputGroupAddon, { onClick }, "Label"),
          createElement(Control),
        ),
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[data-slot="input-group-addon"]')?.click()
    })

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.activeElement?.tagName.toLowerCase()).toBe(
      Control === InputGroupInput ? "input" : "textarea",
    )
  })

  it("respects a prevented click", async () => {
    await act(async () => {
      root.render(
        createElement(
          InputGroup,
          null,
          createElement(InputGroupAddon, {
            onClick: (event) => event.preventDefault(),
          }),
          createElement(InputGroupInput),
        ),
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[data-slot="input-group-addon"]')?.click()
    })

    expect(document.activeElement).toBe(document.body)
  })
})
