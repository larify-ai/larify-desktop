import { Agent, setGlobalDispatcher } from 'undici'

const KEEP_ALIVE_TIMEOUT_MS = 30 * 60 * 1000

export function configureUndiciPool(): void {
  setGlobalDispatcher(
    new Agent({
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: KEEP_ALIVE_TIMEOUT_MS
    })
  )
}
