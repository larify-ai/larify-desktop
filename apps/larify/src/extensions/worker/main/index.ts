import { defineService, type Extension } from '@shared/extension'
import { WorkerService } from './worker-service'

export const workerService = defineService<WorkerService>('worker')

const service = new WorkerService()

const extension: Extension = {
  name: 'worker',
  description: 'Run background tasks.',
  activate(app) {
    app.registerService(workerService, service)
  },
  deactivate() {
    return service.destroy()
  }
}

export default extension
