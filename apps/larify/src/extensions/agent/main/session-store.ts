import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { UIMessage } from "ai"
import { larifyPath } from "../../../main/utils/app-paths"

export interface StoredSession {
  id: string
  createdAt: number
  updatedAt: number
  messages: UIMessage[]
}

export interface SessionMeta {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
}

export interface SessionStore {
  loadSession: (id: string) => Promise<UIMessage[]>
  saveSession: (id: string, messages: UIMessage[]) => Promise<StoredSession>
  listSessions: () => Promise<SessionMeta[]>
}

const safeSessionId = (id: string): string => encodeURIComponent(id || "default")

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(tmp, path)
}

const getText = (message: UIMessage): string => {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

const createTitle = (messages: UIMessage[]): string | undefined => {
  const firstUserText = messages.find((message) => message.role === "user")
  if (!firstUserText) return undefined
  const title = getText(firstUserText).replace(/\s+/g, " ")
  return title || undefined
}

export function createSessionStore(root = larifyPath("sessions")): SessionStore {
  const sessionDir = (id: string): string => join(root, safeSessionId(id))
  const messagesPath = (id: string): string => join(sessionDir(id), "messages.json")
  const metaPath = (id: string): string => join(sessionDir(id), "meta.json")
  const saves = new Map<string, Promise<unknown>>()

  const runSave = async (id: string, messages: UIMessage[]): Promise<StoredSession> => {
    const now = Date.now()
    const previous = await readJson<StoredSession>(messagesPath(id))
    const stored: StoredSession = {
      id,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      messages,
    }
    const meta: SessionMeta = {
      id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      title: previous ? (await readJson<SessionMeta>(metaPath(id)))?.title : createTitle(messages),
    }

    await writeJson(messagesPath(id), stored)
    await writeJson(metaPath(id), meta)
    return stored
  }

  return {
    async loadSession(id) {
      const stored = await readJson<StoredSession>(messagesPath(id))
      return stored?.messages ?? []
    },

    async saveSession(id, messages) {
      const previous = saves.get(id) ?? Promise.resolve()
      const next = previous.then(() => runSave(id, messages))
      saves.set(id, next.finally(() => {
        if (saves.get(id) === next) saves.delete(id)
      }))
      return next
    },

    async listSessions() {
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
      }

      const metas = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readJson<SessionMeta>(join(root, entry.name, "meta.json"))),
      )
      return metas
        .filter((meta): meta is SessionMeta => meta !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
  }
}
