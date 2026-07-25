import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { UIMessage } from "ai"
import { larifyPath } from "../../../main/utils/app-paths"

export interface StoredSession {
  id: string
  createdAt: number
  updatedAt: number
  messages: UIMessage[]
  cwd?: string
}

export interface SessionMeta {
  id: string
  title?: string
  cwd?: string
  createdAt: number
  updatedAt: number
}

export interface SessionStore {
  loadSession: (id: string) => Promise<{ messages: UIMessage[]; cwd: string } | null>
  saveSession: (id: string, messages: UIMessage[], cwd: string) => Promise<StoredSession>
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

export function createSessionStore(
  root = larifyPath("sessions"),
  defaultCwd = larifyPath("workspace"),
): SessionStore {
  const sessionDir = (id: string): string => join(root, safeSessionId(id))
  const messagesPath = (id: string): string => join(sessionDir(id), "messages.json")
  const metaPath = (id: string): string => join(sessionDir(id), "meta.json")
  const saves = new Map<string, Promise<void>>()

  const runSave = async (id: string, messages: UIMessage[], cwd: string): Promise<StoredSession> => {
    const now = Date.now()
    const previous = await readJson<StoredSession>(messagesPath(id))
    const stored: StoredSession = {
      id,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      messages,
      cwd: cwd || defaultCwd,
    }
    const previousMeta = await readJson<SessionMeta>(metaPath(id))
    const meta: SessionMeta = {
      id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      title: previousMeta?.title ?? createTitle(messages),
      cwd: stored.cwd,
    }

    await writeJson(messagesPath(id), stored)
    await writeJson(metaPath(id), meta)
    return stored
  }

  return {
    async loadSession(id) {
      const stored = await readJson<StoredSession>(messagesPath(id))
      if (!stored) return null
      return { messages: stored.messages, cwd: stored.cwd || defaultCwd }
    },

    async saveSession(id, messages, cwd) {
      const previous = saves.get(id) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(() => runSave(id, messages, cwd))
      const tracked = next.then(
        () => undefined,
        () => undefined,
      )
      saves.set(id, tracked)
      void tracked.finally(() => {
        if (saves.get(id) === tracked) saves.delete(id)
      })
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
          .map(async (entry) => {
            try {
              await access(join(root, entry.name, "messages.json"))
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
              throw error
            }
            return readJson<SessionMeta>(join(root, entry.name, "meta.json"))
          }),
      )
      return metas
        .filter((meta): meta is SessionMeta => meta !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
  }
}
