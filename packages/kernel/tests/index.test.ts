import { describe, it, expect } from "vitest"
import * as kernel from "../src/index"
import { createApp, Loader, Registry, Events } from "../src/index"

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
    expect(kernel.createApp).toBe(createApp)
    expect(kernel.Loader).toBe(Loader)
    expect(kernel.Registry).toBe(Registry)
    expect(kernel.Events).toBe(Events)
  })
})
