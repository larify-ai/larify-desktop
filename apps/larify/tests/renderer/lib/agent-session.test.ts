// @vitest-environment jsdom

import { createElement } from "react"
import type { ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const STORAGE_KEY = "larify.activeSessionId"

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  document.body.innerHTML = ""
  vi.resetModules()
})

describe("agent session state", () => {
  it("persists the active session id", async () => {
    const session = await import("../../../src/renderer/src/lib/agent-session")

    session.setAgentSessionId("session-2")

    expect(session.getAgentSessionId()).toBe("session-2")
    expect(localStorage.getItem(STORAGE_KEY)).toBe("session-2")
  })

  it("restores the active session id from localStorage on module load", async () => {
    localStorage.setItem(STORAGE_KEY, "stored-session")

    const session = await import("../../../src/renderer/src/lib/agent-session")

    expect(session.getAgentSessionId()).toBe("stored-session")
  })

  it("updates React subscribers when the session changes", async () => {
    const session = await import("../../../src/renderer/src/lib/agent-session")
    const host = document.createElement("div")
    document.body.append(host)
    let root: Root | null = null

    function Probe(): ReactElement {
      return createElement("div", null, session.useAgentSessionId())
    }

    await act(async () => {
      root = createRoot(host)
      root.render(createElement(Probe))
    })

    await act(async () => {
      session.setAgentSessionId("session-2")
    })

    expect(host.textContent).toBe("session-2")

    await act(async () => {
      root?.unmount()
    })
  })
})
