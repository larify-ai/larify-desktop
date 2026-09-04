import { APICallError, AISDKError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import { isRetryableStreamError } from '../../../../src/main/core/agent/engine'

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    statusCode,
    url: 'http://example.com/api',
    requestBodyValues: {}
  })
}

describe('isRetryableStreamError', () => {
  it('treats a raw network TypeError (terminated) as retryable', () => {
    const err = Object.assign(new TypeError('terminated'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    })
    expect(isRetryableStreamError(err)).toBe(true)
  })

  it('does not retry a user abort (AbortError)', () => {
    const err = new DOMException('Aborted', 'AbortError')
    expect(isRetryableStreamError(err)).toBe(false)
  })

  it('retries 429 (rate limit)', () => {
    expect(isRetryableStreamError(apiError(429))).toBe(true)
  })

  it('retries 5xx (server error)', () => {
    expect(isRetryableStreamError(apiError(503))).toBe(true)
  })

  it('does not retry client 4xx (except 429)', () => {
    expect(isRetryableStreamError(apiError(404))).toBe(false)
    expect(isRetryableStreamError(apiError(400))).toBe(false)
  })

  it('does not retry a non-APICallError AISDKError (SDK validation/config)', () => {
    // AISDKError 基类本身不是 APICallError 子类
    const err = new AISDKError({ errorName: 'AI_Test', errorMessage: 'bad config' })
    expect(AISDKError.isInstance(err)).toBe(true)
    expect(APICallError.isInstance(err)).toBe(false)
    expect(isRetryableStreamError(err)).toBe(false)
  })

  it('does not retry a non-Error value', () => {
    expect(isRetryableStreamError('boom')).toBe(false)
    expect(isRetryableStreamError(null)).toBe(false)
    expect(isRetryableStreamError(undefined)).toBe(false)
  })

  it('still retries a 500 that is also an AISDKError (APICallError subclass)', () => {
    // APICallError 是 AISDKError 的子类；非 4xx 且非 429 的应重试
    const err = apiError(500)
    expect(AISDKError.isInstance(err)).toBe(true)
    expect(APICallError.isInstance(err)).toBe(true)
    expect(isRetryableStreamError(err)).toBe(true)
  })
})
