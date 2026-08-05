import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class SqliteService {
  private readonly databases = new Set<DatabaseSync>()

  open(path: string): DatabaseSync {
    mkdirSync(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    this.databases.add(database)
    return database
  }

  close(database: DatabaseSync): void {
    database.close()
    this.databases.delete(database)
  }

  closeAll(): void {
    for (const database of this.databases) database.close()
    this.databases.clear()
  }
}
