import { describe, it, expect, vi } from "vitest"
import { createApp } from "../src/host"
import { Loader } from "../src/loader"
import type { Extension, Manifest } from "../src/types"

function mani(id: string): Manifest {
  return { id, version: "1.0.0" }
}

function makeLoader(exts: Record<string, Extension>) {
  const app = createApp()
  const loader = new Loader(app, async (m) => ({ default: exts[m.id] }))
  return { app, loader }
}

describe("Loader", () => {
  it("load 跑 activate,注册的东西能拿到", async () => {
    const { app, loader } = makeLoader({
      serial: {
        activate(app) {
          app.register("tool", "flash", { v: 1 })
        },
      },
    })
    await loader.load(mani("serial"))
    expect(app.get("tool", "flash")).toEqual({ v: 1 })
  })

  it("isLoaded 反映加载状态", async () => {
    const { loader } = makeLoader({ a: { activate() {} } })
    expect(loader.isLoaded("a")).toBe(false)
    await loader.load(mani("a"))
    expect(loader.isLoaded("a")).toBe(true)
    await loader.unload("a")
    expect(loader.isLoaded("a")).toBe(false)
  })

  it("load 幂等:同 id 装两遍,activate 只跑一次", async () => {
    const activate = vi.fn()
    const { loader } = makeLoader({ a: { activate } })
    await loader.load(mani("a"))
    await loader.load(mani("a"))
    expect(activate).toHaveBeenCalledOnce()
  })


  it("⭐scopedApp 自动登记:register 不手动 push,unload 后自动清理", async () => {
    const { app, loader } = makeLoader({
      serial: {
        activate(app) {
          app.register("tool", "flash", { v: 1 }) // 没手动 push
        },
      },
    })
    await loader.load(mani("serial"))
    expect(app.get("tool", "flash")).toEqual({ v: 1 })
    await loader.unload("serial")
    expect(app.get("tool", "flash")).toBeUndefined() // 自动清掉了
  })

  it("⭐scopedApp 自动登记:on 订阅 unload 后自动取消", async () => {
    const handler = vi.fn()
    const { app, loader } = makeLoader({
      serial: {
        activate(app) {
          app.on("ping", handler)
        },
      },
    })
    await loader.load(mani("serial"))
    app.emit("ping")
    expect(handler).toHaveBeenCalledOnce()
    await loader.unload("serial")
    app.emit("ping")
    expect(handler).toHaveBeenCalledOnce() // unload 后不再收到
  })

  it("reload 应用新版本(先卸再装)", async () => {
    const exts: Record<string, Extension> = {
      serial: { activate: (app) => void app.register("tool", "x", "v1") },
    }
    const app = createApp()
    const loader = new Loader(app, async (m) => ({ default: exts[m.id] }))
    await loader.load(mani("serial"))
    expect(app.get("tool", "x")).toBe("v1")
    exts.serial = { activate: (app) => void app.register("tool", "x", "v2") }
    await loader.reload(mani("serial"))
    expect(app.get("tool", "x")).toBe("v2")
  })

  it("loadAll / unloadAll", async () => {
    const { app, loader } = makeLoader({
      a: { activate: (app) => void app.register("tool", "a", 1) },
      b: { activate: (app) => void app.register("tool", "b", 2) },
    })
    await loader.loadAll([mani("a"), mani("b")])
    expect(app.getAll("tool").sort()).toEqual([1, 2])
    await loader.unloadAll()
    expect(app.getAll("tool")).toEqual([])
  })

  it("unloadAll 按加载逆序卸载插件(后装的先卸)", async () => {
    const order: string[] = []
    const make = (id: string): Extension => ({
      activate(app) {
        app.register("tool", id, id)
        app.on(`__unload_${id}`, () => {})
      },
    })
    const app = createApp()
    const loader = new Loader(app, async (m) => ({ default: make(m.id) }))
    // 包一层:unload 时记录顺序
    const origUnload = loader.unload.bind(loader)
    loader.unload = async (id: string) => {
      order.push(id)
      return origUnload(id)
    }
    await loader.loadAll([mani("a"), mani("b"), mani("c")])
    await loader.unloadAll()
    expect(order).toEqual(["c", "b", "a"])
  })

  it("load 等 async activate 完成才可见", async () => {
    let resolveActivate: () => void
    const gate = new Promise<void>((r) => (resolveActivate = r))
    const { app, loader } = makeLoader({
      serial: {
        async activate(app) {
          await gate
          app.register("tool", "flash", 1)
        },
      },
    })
    const loading = loader.load(mani("serial"))
    expect(app.get("tool", "flash")).toBeUndefined() // activate 还没完成
    resolveActivate!()
    await loading
    expect(app.get("tool", "flash")).toBe(1) // 完成后才可见
  })

  it("unload 不存在的 id 不报错", async () => {
    const { loader } = makeLoader({})
    await expect(loader.unload("nope")).resolves.toBeUndefined()
  })

  it("⭐activate 抛错:回滚已注册的,不残留,可重试", async () => {
    const exts: Record<string, Extension> = {
      serial: {
        activate(app) {
          app.register("tool", "flash", 1) // 注册了
          throw new Error("boom") // 然后崩
        },
      },
    }
    const app = createApp()
    const loader = new Loader(app, async (m) => ({ default: exts[m.id] }))
    await expect(loader.load(mani("serial"))).rejects.toThrow("boom")
    expect(app.get("tool", "flash")).toBeUndefined() // 回滚了,不残留
    expect(loader.isLoaded("serial")).toBe(false) // 没标记加载

    exts.serial = { activate: (app) => void app.register("tool", "flash", 2) }
    await expect(loader.load(mani("serial"))).resolves.toBeUndefined() // 修好后可重试
    expect(loader.isLoaded("serial")).toBe(true)
    expect(app.get("tool", "flash")).toBe(2)
  })

  it("⭐unload 中某个 dispose 抛错,不拖累其余,且插件一定被摘牌", async () => {
    const disposed: string[] = []
    const stubApp = {
      register: (_k: string, name: string) => ({
        dispose: () => {
          if (name === "bad") throw new Error("dispose boom")
          disposed.push(name)
        },
      }),
      on: () => ({ dispose: () => {} }),
      get: () => undefined,
      getAll: () => [],
      emit: () => {},
    }
    const loader = new Loader(stubApp, async () => ({
      default: {
        activate(app) {
          app.register("tool", "good1", 1)
          app.register("tool", "bad", 2)
          app.register("tool", "good2", 3)
        },
      } as Extension,
    }))
    await loader.load(mani("serial"))
    await expect(loader.unload("serial")).resolves.toBeUndefined()
    expect(disposed.sort()).toEqual(["good1", "good2"]) // 坏的没拖累好的
    expect(loader.isLoaded("serial")).toBe(false) // 一定摘牌
  })

  it("scopedApp 的 get/getAll/emit 透传到底层 app", async () => {
    const seen: unknown[] = []
    const { app, loader } = makeLoader({
      serial: {
        activate(scoped) {
          // 底层先有一个别人注册的东西
          app.register("tool", "pre", "P")
          // 通过 scoped 读到底层已有的
          expect(scoped.get("tool", "pre")).toBe("P")
          expect(scoped.getAll("tool")).toEqual(["P"])
          // scoped.emit 透传到底层 events
          app.on("e", (p) => seen.push(p))
          scoped.emit("e", "hi")
        },
      },
    })
    await loader.load(mani("serial"))
    expect(seen).toEqual(["hi"])
  })

  it("importExtension 收到正确的 manifest", async () => {
    const app = createApp()
    const importFn = vi.fn(async (_m: Manifest) => ({
      default: { activate() {} } as Extension,
    }))
    const loader = new Loader(app, importFn)
    const m = mani("serial")
    await loader.load(m)
    expect(importFn).toHaveBeenCalledWith(m)
  })

  it("scopedApp.register 返回的 dispose 也是底层的 dispose(手动 dispose 生效)", async () => {
    const { app, loader } = makeLoader({
      serial: {
        activate(scoped) {
          const d = scoped.register("tool", "x", 1)
          d.dispose() // 手动 dispose,底层应立即移除
        },
      },
    })
    await loader.load(mani("serial"))
    expect(app.get("tool", "x")).toBeUndefined()
  })

  it("unload 按逆序 dispose subscriptions", async () => {
    const order: number[] = []
    const stubApp = {
      register: (_k: string, _n: string, _v: unknown) => ({
        dispose: () => order.push(1),
      }),
      on: (_e: string, _h: (p: unknown) => void) => ({
        dispose: () => order.push(2),
      }),
      get: () => undefined,
      getAll: () => [],
      emit: () => {},
    }
    const loader = new Loader(stubApp, async () => ({
      default: {
        activate(scoped) {
          scoped.register("tool", "a", 1) // dispose 记 1
          scoped.on("e", () => {}) // dispose 记 2
        },
      } as Extension,
    }))
    await loader.load(mani("serial"))
    await loader.unload("serial")
    expect(order).toEqual([2, 1]) // 逆序:先 on(2) 后 register(1)
  })
})
