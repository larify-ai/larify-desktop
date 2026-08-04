import { describe, it, expect } from "vitest"
import * as extension from "../../src/shared/extension"
import { createApp, Loader, Registry, Events } from "../../src/shared/extension"

describe("index 导出", () => {
  it("createApp / Loader / Registry / Events 都能 import 且可用", () => {
    expect(typeof createApp).toBe("function")
    expect(typeof Loader).toBe("function")
    expect(typeof Registry).toBe("function")
    expect(typeof Events).toBe("function")
    expect(createApp()).toBeDefined()
    expect(new Registry()).toBeInstanceOf(Registry)
    expect(new Events()).toBeInstanceOf(Events)
  })

  it("命名空间导出包含全部公开符号", () => {
    expect(extension.createApp).toBe(createApp)
    expect(extension.Loader).toBe(Loader)
    expect(extension.Registry).toBe(Registry)
    expect(extension.Events).toBe(Events)
  })
})
