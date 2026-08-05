/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { DatabaseSync } from 'node:sqlite'
import { threadId } from 'node:worker_threads'

const databases = new Map()

export default function run({ path, sql, query }) {
  let database = databases.get(path)
  if (!database) {
    database = new DatabaseSync(path)
    databases.set(path, database)
  }
  if (sql) database.exec(sql)
  return { threadId, value: query ? database.prepare(query).get() : undefined }
}

export function close() {
  for (const database of databases.values()) database.close()
  databases.clear()
}
