import { getModelApiService } from './service'
import { registerModelApiIpc } from './ipc'

export { getModelApiService } from './service'
export type { ModelApiService } from './service'

let initialized = false

export async function registerModelApi(): Promise<void> {
  if (initialized) return
  initialized = true
  const service = getModelApiService()
  await service.init()
  registerModelApiIpc(service)
}
