import type { SessionAttentionState } from './session-attention'

/**
 * 会话需要你注意时的提示音：`waiting`（等待处理 / 等待回答）两声上扬，
 * `unread`（后台有新消息）一声温和。
 *
 * - **纯附加**：不改动 attention 状态机，也不感知会话身份。
 * - **无配置**：音量跟随系统，不设开关与音量项。
 * - **不阻塞**：Web Audio 合成音（无资源、无网络、无解码），任何失败静默降级。
 */

/** 两种状态各自的音色（相对起点秒数 + 频率 Hz）。 */
const SOUND_PATTERNS: Record<'waiting' | 'unread', Array<{ at: number; frequency: number }>> = {
  waiting: [
    { at: 0, frequency: 880 },
    { at: 0.16, frequency: 1174.66 }
  ],
  unread: [{ at: 0, frequency: 659.25 }]
}

const NOTE_DURATION_SECONDS = 0.14
const NOTE_VOLUME = 0.18

/** 单例 AudioContext：反复 new 会耗尽浏览器允许的上下文数量（≈6 个）。 */
let context: AudioContext | undefined

function play(state: 'waiting' | 'unread'): void {
  const pattern = SOUND_PATTERNS[state]
  if (!pattern) return
  try {
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!Ctor) return
    context ??= new Ctor()
    // Electron/Chromium 的 autoplay 策略会让无用户手势的上下文 suspended；
    // resume 成功与否都不阻塞，失败就静默放弃。
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    const start = context.currentTime
    for (const note of pattern) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const begin = start + note.at
      const end = begin + NOTE_DURATION_SECONDS
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(note.frequency, begin)
      // 两端各留一小段渐变，避免爆音（直接 0→1 会有 click）。
      gain.gain.setValueAtTime(0, begin)
      gain.gain.linearRampToValueAtTime(NOTE_VOLUME, begin + 0.01)
      gain.gain.linearRampToValueAtTime(0, end)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(begin)
      oscillator.stop(end)
    }
  } catch {
    // 提示音是纯附加能力：任何失败都不得影响会话流程。
  }
}

/**
 * 会话状态跳变 → 是否需要响、以及响哪一种音。
 *
 * 只有 `waiting` / `unread` 该响，且与 `previous` 必须不同态：同态重复上报
 * （如 `waiting → waiting`）不响。
 *
 * 判定与播放放在一起，调用方只负责把状态变化穿进来——`sessions.tsx` 因此
 * 只需一行调用，不必复制这份判据。
 */
export function playSessionStatusSound(
  state: SessionAttentionState,
  previous: SessionAttentionState | undefined
): void {
  if (state !== 'waiting' && state !== 'unread') return
  if (previous === state) return
  play(state)
}
