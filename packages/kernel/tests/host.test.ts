import { describe, it, expect, vi } from "vitest"
import { createApp } from "../src/host"

describe("createApp (host 门面)", () => {
  it("register/get/getAll 转发到内部 registry", () => {
    const app = createApp()
    app.register("tool", "flash", { v: 1 })
    expect(app.get("tool", "flash")).toEqual({ v: 1 })
    expect(app.getAll("tool")).toEqual([{ v: 1 }])
  })

  it("on/emit 转发到内部 events,payload 传对", () => {
    const app = createApp()
    const handler = vi.fn()
    app.on("ping", handler)
    app.emit("ping", 42)
    expect(handler).toHaveBeenCalledWith(42)
  })

  it("register 返回的 dispose 能移除", () => {
    const app = createApp()
    const d = app.register("tool", "x", "v")
    d.dispose()
    expect(app.get("tool", "x")).toBeUndefined()
  })

  it("on 返回的 dispose 能取消订阅", () => {
    const app = createApp()
    const handler = vi.fn()
    const d = app.on("x", handler)
    d.dispose()
    app.emit("x")
    expect(handler).not.toHaveBeenCalled()
  })

  it("两个 app 实例互相隔离(独立 registry + events)", () => {
    const a = createApp()
    const b = createApp()
    const handlerA = vi.fn()
    a.register("tool", "x", "A")
    a.on("e", handlerA)
    expect(b.get("tool", "x")).toBeUndefined()
    expect(b.getAll("tool")).toEqual([])
    b.emit("e")
    expect(handlerA).not.toHaveBeenCalled()
  })

  it("返回对象上不暴露私有 registry / events", () => {
    const app = createApp()
    expect("registry" in app).toBe(false)
    expect("events" in app).toBe(false)
    expect(Object.keys(app).sort()).toEqual(
      ["emit", "get", "getAll", "on", "register"].sort(),
    )
  })
})
