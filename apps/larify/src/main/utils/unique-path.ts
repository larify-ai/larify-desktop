import { closeSync, mkdirSync, openSync } from "node:fs"
import { join } from "node:path"
import { customAlphabet } from "nanoid"

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
const ID_LENGTH = 8
const MAX_ATTEMPTS = 8

const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`)

const generateId = customAlphabet(ID_ALPHABET, ID_LENGTH)

export const shortToken = (): string => generateId()

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST"
}

export function createUniqueFile(dir: string, extension?: string, preferredId?: string): string {
  const seedId = preferredId && ID_PATTERN.test(preferredId) ? preferredId : undefined
  mkdirSync(dir, { recursive: true })
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const id = attempt === 0 && seedId ? seedId : generateId()
    const path = join(dir, extension ? `${id}.${extension}` : id)
    try {
      closeSync(openSync(path, "wx"))
      return path
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  }
  throw new Error(`Could not allocate a unique file name in ${dir}`)
}

export function createUniqueDir(parent: string): string {
  mkdirSync(parent, { recursive: true })
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const path = join(parent, generateId())
    try {
      mkdirSync(path)
      return path
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  }
  throw new Error(`Could not allocate a unique directory name in ${parent}`)
}
