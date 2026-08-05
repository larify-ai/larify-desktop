import { defineService, type Extension } from '@shared/extension'
import { SqliteService } from './sqlite-service'

export const sqliteService = defineService<SqliteService>('sqlite')

const service = new SqliteService()

const extension: Extension = {
  name: 'sqlite',
  description: 'Provide SQLite databases.',
  activate(app) {
    app.registerService(sqliteService, service)
  },
  deactivate() {
    service.closeAll()
  }
}

export default extension
