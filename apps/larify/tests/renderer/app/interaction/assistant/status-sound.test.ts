// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 被测模块持有一个模块级单例 AudioContext，因此**每个用例必须先重置模块**，
 * 否则第一个用例缓存的实例会让后续替换 `window.AudioContext` 失效——
 * 那正是「假测试」的来源（静音用例永远数到 0，变异也抓不住）。
 */
async function loadModule(): Promise<
  typeof import('../../../../../src/renderer/src/app/interaction/assistant/status-sound')
> {
  vi.resetModules()
  return import('../../../../../src/renderer/src/app/interaction/assistant/status-sound')
}

interface Spy {
  notes: number[]
}

/** 最小 Web Audio 桩：每次 createOscillator 记一个音符，并暴露给断言。 */
function stubWebAudio(): Spy {
  const spy: Spy = { notes: [] }
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator() {
      spy.notes.push(0)
      return {
        type: '',
        frequency: { setValueAtTime: (value: number) => spy.notes.push(value) },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined
      }
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
        connect: () => undefined
      }
    }
    resume() {
      return Promise.resolve()
    }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
  return spy
}

beforeEach(() => {
  vi.resetModules()
})

describe('playSessionStatusSound', () => {
  it('plays a two-note cue on entering waiting', async () => {
    const spy = stubWebAudio()
    const { playSessionStatusSound } = await loadModule()
    playSessionStatusSound('waiting', 'active')
    // 两个音符 → 两次 createOscillator（每次还 push 一个频率值）。
    expect(spy.notes.filter((value) => value === 0)).toHaveLength(2)
    expect(spy.notes).toContain(880)
    expect(spy.notes).toContain(1174.66)
  })

  it('plays a one-note cue on entering unread', async () => {
    const spy = stubWebAudio()
    const { playSessionStatusSound } = await loadModule()
    playSessionStatusSound('unread', 'active')
    expect(spy.notes.filter((value) => value === 0)).toHaveLength(1)
    expect(spy.notes).toContain(659.25)
  })

  it('never touches Web Audio for idle/active or a repeated state', async () => {
    const spy = stubWebAudio()
    const { playSessionStatusSound } = await loadModule()
    playSessionStatusSound('idle', 'active')
    playSessionStatusSound('active', 'idle')
    playSessionStatusSound('waiting', 'waiting')
    playSessionStatusSound('unread', 'unread')
    playSessionStatusSound('unread', 'unread')
    expect(spy.notes).toEqual([])
  })

  it('never throws when Web Audio is unavailable', async () => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
    const { playSessionStatusSound } = await loadModule()
    expect(() => playSessionStatusSound('unread', 'active')).not.toThrow()
  })

  it('never throws when the audio graph fails', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {
        constructor() {
          throw new Error('audio blocked')
        }
      }
    })
    const { playSessionStatusSound } = await loadModule()
    expect(() => playSessionStatusSound('waiting', 'active')).not.toThrow()
  })
})
