// @vitest-environment jsdom

import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import {
  ModelConfigContext,
  readModelConfig,
  readSessionModelConfig,
  useModelConfig,
  writeModelConfig,
  writeSessionModelConfig,
  MODEL_CONFIG_KEY
} from '../../../../../src/renderer/src/app/interaction/assistant/model-config'

describe('model config storage', () => {
  beforeEach(() => localStorage.clear())

  describe('readSessionModelConfig', () => {
    it('returns the session config when present', () => {
      const config = { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' }
      writeSessionModelConfig('chat', localStorage, config)

      expect(readSessionModelConfig('chat', localStorage)).toEqual(config)
    })

    it('falls back to the global default when the session is not set', () => {
      const global = { modelId: 'deepseek-flash', reasoningEffort: 'high' }
      writeModelConfig(localStorage, global)

      expect(readSessionModelConfig('chat', localStorage)).toEqual(global)
    })

    it('treats an invalid session config as unset and falls back', () => {
      const global = { modelId: 'deepseek-flash', reasoningEffort: 'off' }
      writeModelConfig(localStorage, global)
      localStorage.setItem(`${MODEL_CONFIG_KEY}.chat`, 'not-json')

      expect(readSessionModelConfig('chat', localStorage)).toEqual(global)
    })

    it('keeps session configs isolated between sessions', () => {
      const a = { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' }
      writeSessionModelConfig('chat-a', localStorage, a)
      writeSessionModelConfig('chat-b', localStorage, {
        modelId: 'deepseek-flash',
        reasoningEffort: 'off'
      })

      expect(readSessionModelConfig('chat-a', localStorage)).toEqual(a)
      expect(readSessionModelConfig('chat-b', localStorage)).toEqual({
        modelId: 'deepseek-flash',
        reasoningEffort: 'off'
      })
      expect(readSessionModelConfig('chat-c', localStorage)).toEqual(readModelConfig(localStorage))
    })

    it('prefers the session config even after the global model changes', () => {
      const session = { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' }
      writeSessionModelConfig('chat', localStorage, session)

      // 用户在别处改了全局默认，但该会话仍回显自己的固化值
      writeModelConfig(localStorage, { modelId: 'deepseek-flash', reasoningEffort: 'off' })

      expect(readSessionModelConfig('chat', localStorage)).toEqual(session)
    })

    it('clears a session model so the fallback returns to the global default', () => {
      writeSessionModelConfig('chat', localStorage, {
        modelId: 'deepseek-v4-pro',
        reasoningEffort: 'max'
      })
      localStorage.removeItem(`${MODEL_CONFIG_KEY}.chat`)

      const global = { modelId: 'deepseek-flash', reasoningEffort: 'high' }
      writeModelConfig(localStorage, global)
      expect(readSessionModelConfig('chat', localStorage)).toEqual(global)
    })
  })

  describe('writeSessionModelConfig', () => {
    it('stores the config under the session key only, leaving the global untouched', () => {
      const global = { modelId: 'deepseek-flash', reasoningEffort: 'off' }
      writeModelConfig(localStorage, global)
      writeSessionModelConfig('chat', localStorage, {
        modelId: 'deepseek-v4-pro',
        reasoningEffort: 'max'
      })

      expect(localStorage.getItem(`${MODEL_CONFIG_KEY}.chat`)).toBe(
        JSON.stringify({ modelId: 'deepseek-v4-pro', reasoningEffort: 'max' })
      )
      expect(readModelConfig(localStorage)).toEqual(global)
    })
  })
})

describe('ModelConfigContext / useModelConfig', () => {
  let root: Root | undefined
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
  })

  it('throws when used outside a provider', () => {
    let error: unknown
    function Broken(): React.JSX.Element | null {
      try {
        useModelConfig()
      } catch (e) {
        error = e
      }
      return null
    }
    root = createRoot(document.createElement('div'))
    act(() => {
      root!.render(createElement(Broken))
    })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/ModelConfigContext is missing/)
  })

  it('returns the value and onChange from the provider', () => {
    const value = { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' }
    const onChange = (): void => {}
    let captured: unknown
    function Probe(): null {
      captured = useModelConfig()
      return null
    }
    root = createRoot(document.createElement('div'))
    act(() => {
      root!.render(
        createElement(
          ModelConfigContext.Provider,
          { value: { value, onChange } },
          createElement(Probe)
        )
      )
    })
    expect(captured).toEqual({ value, onChange })
  })
})
