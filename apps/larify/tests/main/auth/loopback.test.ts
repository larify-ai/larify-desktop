import { afterEach, describe, expect, it } from 'vitest'

import { openLoopbackCallback, type LoopbackCallback } from '../../../src/main/auth/loopback'

describe('OAuth loopback callback', () => {
  let callback: LoopbackCallback | undefined

  afterEach(() => callback?.close())

  it('uses a random localhost port and returns the authorization response URL', async () => {
    callback = await openLoopbackCallback()
    const response = await fetch(`${callback.redirectUri}?code=code-1&state=state-1`)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('window.close()')
    const result = await callback.result
    expect(result.hostname).toBe('127.0.0.1')
    expect(result.pathname).toBe('/callback')
    expect(result.searchParams.get('code')).toBe('code-1')
    expect(result.searchParams.get('state')).toBe('state-1')
  })

  it('does not accept callbacks on another path', async () => {
    callback = await openLoopbackCallback()
    const response = await fetch(new URL('/wrong-path', callback.redirectUri))

    expect(response.status).toBe(404)
  })
})
