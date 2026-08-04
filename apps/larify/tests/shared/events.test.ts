import { describe, it, expect, vi } from "vitest"
import { Events } from "../../src/shared/events"

describe("Events", () => {
  it("emit 会调用订阅的 handler,并把 payload 传进去", () => {
    const events = new Events()
    const handler = vi.fn()
    events.on("hello", handler)
    events.emit("hello", { text: "hi" })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ text: "hi" })
  })

  it("同一事件的多个 handler 都会被调用", () => {
    const events = new Events()
    const a = vi.fn()
    const b = vi.fn()
    events.on("x", a)
    events.on("x", b)
    events.emit("x")
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it("没人订阅的事件 emit 不报错", () => {
    const events = new Events()
    expect(() => events.emit("nobody")).not.toThrow()
  })

  it("只通知订阅了该事件的 handler,不误伤别的事件", () => {
    const events = new Events()
    const onFoo = vi.fn()
    const onBar = vi.fn()
    events.on("foo", onFoo)
    events.on("bar", onBar)
    events.emit("foo")
    expect(onFoo).toHaveBeenCalledOnce()
    expect(onBar).not.toHaveBeenCalled()
  })

  it("dispose 后不再收到事件", () => {
    const events = new Events()
    const handler = vi.fn()
    const sub = events.on("x", handler)
    events.emit("x")
    sub.dispose()
    events.emit("x")
    expect(handler).toHaveBeenCalledOnce()
  })

  it("同一个 handler 订阅两次(Set 去重)只被调一次", () => {
    const events = new Events()
    const handler = vi.fn()
    events.on("x", handler)
    events.on("x", handler)
    events.emit("x")
    expect(handler).toHaveBeenCalledOnce()
  })

  it("emit 中途新增订阅,不会在本次 emit 里被调(快照防迭代中修改)", () => {
    const events = new Events()
    const late = vi.fn()
    const first = vi.fn(() => events.on("x", late))
    events.on("x", first)
    events.emit("x")
    expect(first).toHaveBeenCalledOnce()
    expect(late).not.toHaveBeenCalled()
    events.emit("x")
    expect(late).toHaveBeenCalledOnce()
  })

  it("double dispose 不报错", () => {
    const events = new Events()
    const sub = events.on("x", vi.fn())
    sub.dispose()
    expect(() => sub.dispose()).not.toThrow()
  })

  it("dispose 后同名事件重新订阅,旧 dispose 不误删新的", () => {
    const events = new Events()
    const old = vi.fn()
    const sub1 = events.on("x", old)
    sub1.dispose()
    const fresh = vi.fn()
    events.on("x", fresh)
    sub1.dispose() // 旧 dispose 再调
    events.emit("x")
    expect(fresh).toHaveBeenCalledOnce()
    expect(old).not.toHaveBeenCalled()
  })

  it("⭐一个 handler 抛错,其他 handler 照样收到(兜底隔离)", () => {
    const events = new Events()
    const before = vi.fn()
    const after = vi.fn()
    events.on("x", before)
    events.on("x", () => {
      throw new Error("boom")
    })
    events.on("x", after)
    expect(() => events.emit("x")).not.toThrow()
    expect(before).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce() // 坏的没拖累后面的
  })

  it("emit 中途 dispose 别的 handler:快照语义,被 dispose 的仍收到本次", () => {
    const events = new Events()
    const b = vi.fn()
    let subB: { dispose(): void }
    const a = vi.fn(() => subB.dispose())
    events.on("x", a)
    subB = events.on("x", b)
    expect(() => events.emit("x")).not.toThrow()
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce() // 快照在循环开始前取,本次仍收到
    events.emit("x")
    expect(b).toHaveBeenCalledOnce() // 下一次真的没了
  })
})
