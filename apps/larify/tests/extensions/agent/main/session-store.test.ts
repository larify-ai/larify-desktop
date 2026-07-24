import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { createSessionStore } from "../../../../src/extensions/agent/main/session-store"

describe("session store", () => {
  it("saves and loads UI messages with meta", async () => {
    const root = await mkdtemp(join(tmpdir(), "larify-sessions-"))
    try {
      const store = createSessionStore(root)
      const messages: UIMessage[] = [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "hidden searchable answer" }],
        },
      ]

      const saved = await store.saveSession("chat/one", messages)
      const loaded = await store.loadSession("chat/one")
      const meta = JSON.parse(
        await readFile(join(root, "chat%2Fone", "meta.json"), "utf8"),
      ) as { id: string; title?: string; updatedAt: number }
      const sessions = await store.listSessions()

      expect(saved.id).toBe("chat/one")
      expect(loaded).toEqual(messages)
      expect(meta).toMatchObject({ id: "chat/one", title: "hello" })
      expect(meta.updatedAt).toBe(saved.updatedAt)
      expect(sessions).toEqual([meta])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("serializes concurrent saves for the same session", async () => {
    const root = await mkdtemp(join(tmpdir(), "larify-sessions-"))
    try {
      const store = createSessionStore(root)
      const first: UIMessage[] = [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "first" }] },
      ]
      const second: UIMessage[] = [
        { id: "user-2", role: "user", parts: [{ type: "text", text: "second" }] },
      ]

      await Promise.all([
        store.saveSession("chat/one", first),
        store.saveSession("chat/one", second),
      ])

      expect(await store.loadSession("chat/one")).toEqual(second)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("allows a later save after an earlier save fails", async () => {
    const parent = await mkdtemp(join(tmpdir(), "larify-sessions-"))
    const root = join(parent, "sessions")
    try {
      await writeFile(root, "blocks directory creation")
      const store = createSessionStore(root)
      const messages: UIMessage[] = [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "recovered" }] },
      ]

      await expect(store.saveSession("chat", messages)).rejects.toThrow()
      await rm(root)
      await mkdir(root)

      await expect(store.saveSession("chat", messages)).resolves.toMatchObject({ id: "chat" })
      expect(await store.loadSession("chat")).toEqual(messages)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
