import { describe, it, expect } from "vitest"
import { Registry } from "../../src/shared/registry"

describe("Registry", () => {
  it("register 后能 get 回来", () => {
    const r = new Registry()
    r.register("tool", "flash", { call: 1 })
    expect(r.get("tool", "flash")).toEqual({ call: 1 })
  })

  it("get 不存在的返回 undefined", () => {
    const r = new Registry()
    expect(r.get("tool", "nope")).toBeUndefined()
    expect(r.get("nokind", "x")).toBeUndefined()
  })

  it("getAll 返回一类的全部", () => {
    const r = new Registry()
    r.register("tool", "a", 1)
    r.register("tool", "b", 2)
    expect(r.getAll("tool").sort()).toEqual([1, 2])
  })

  it("getAll 空类返回空数组", () => {
    const r = new Registry()
    expect(r.getAll("tool")).toEqual([])
  })

  it("getAll 不混淆不同 kind", () => {
    const r = new Registry()
    r.register("tool", "a", "T")
    r.register("view", "a", "V")
    expect(r.getAll("tool")).toEqual(["T"])
    expect(r.getAll("view")).toEqual(["V"])
    expect(r.get("tool", "a")).toBe("T")
    expect(r.get("view", "a")).toBe("V")
  })

  it("同名 register 覆盖(Map.set 语义,不报错)", () => {
    const r = new Registry()
    r.register("tool", "flash", "v1")
    expect(() => r.register("tool", "flash", "v2")).not.toThrow()
    expect(r.get("tool", "flash")).toBe("v2")
    expect(r.getAll("tool")).toEqual(["v2"])
  })

  it("dispose 移除该注册", () => {
    const r = new Registry()
    const d = r.register("tool", "flash", "v")
    expect(r.get("tool", "flash")).toBe("v")
    d.dispose()
    expect(r.get("tool", "flash")).toBeUndefined()
    expect(r.getAll("tool")).toEqual([])
  })

  it("double dispose 不报错", () => {
    const r = new Registry()
    const d = r.register("tool", "flash", "v")
    d.dispose()
    expect(() => d.dispose()).not.toThrow()
  })

  it("⭐double dispose 不误删重新注册的(身份检查)", () => {
    const r = new Registry()
    const d1 = r.register("tool", "flash", "v1")
    d1.dispose()
    r.register("tool", "flash", "v2") // 重新注册同名
    d1.dispose() // 旧 dispose 再调,不能删掉 v2
    expect(r.get("tool", "flash")).toBe("v2")
  })
})
