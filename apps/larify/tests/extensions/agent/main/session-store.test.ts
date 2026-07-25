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

      const saved = await store.saveSession("chat/one", messages, "/workspace/proj")
      const loaded = await store.loadSession("chat/one")
      const meta = JSON.parse(
        await readFile(join(root, "chat%2Fone", "meta.json"), "utf8"),
      ) as { id: string; title?: string; updatedAt: number }
      const sessions = await store.listSessions()

      expect(saved.id).toBe("chat/one")
      expect(loaded).toEqual({ messages, cwd: "/workspace/proj" })
      expect(meta).toMatchObject({ id: "chat/one", title: "hello" })
      expect(meta.updatedAt).toBe(saved.updatedAt)
      expect(sessions).toEqual([meta])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("returns the default cwd when old meta has no cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "larify-sessions-"))
    try {
      const store = createSessionStore(root, "/default/workspace")
      const messages: UIMessage[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ]

      // simulate an old meta.json without cwd
      const sessionDir = join(root, encodeURIComponent("s1"))
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, "messages.json"),
        JSON.stringify({ id: "s1", createdAt: 100, updatedAt: 200, messages }),
      )
      await writeFile(
        join(sessionDir, "meta.json"),
        JSON.stringify({ id: "s1", createdAt: 100, updatedAt: 200, title: "hi" }),
      )

      const loaded = await store.loadSession("s1")
      expect(loaded).toEqual({ messages, cwd: "/default/workspace" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("does not list metadata-only sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "larify-sessions-"))
    try {
      const store = createSessionStore(root)
      const sessionDir = join(root, encodeURIComponent("empty"))
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, "meta.json"),
        JSON.stringify({ id: "empty", createdAt: 100, updatedAt: 200 }),
      )
      expect(await store.listSessions()).toEqual([])
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
        store.saveSession("chat/one", first, "/cwd1"),
        store.saveSession("chat/one", second, "/cwd2"),
      ])

      const loaded = await store.loadSession("chat/one")
      expect(loaded?.messages).toEqual(second)
      expect(loaded?.cwd).toBe("/cwd2")
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

      await expect(store.saveSession("chat", messages, "/cwd")).rejects.toThrow()
      await rm(root)
      await mkdir(root)

      await expect(store.saveSession("chat", messages, "/cwd")).resolves.toMatchObject({ id: "chat" })
      const loaded = await store.loadSession("chat")
      expect(loaded).toEqual({ messages, cwd: "/cwd" })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
