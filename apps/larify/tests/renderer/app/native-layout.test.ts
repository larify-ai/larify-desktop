// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushNativeLayout,
  nativeLayoutEvent,
  notifyWorkbenchAnimation,
  workbenchAnimationEvent,
  type NativeLayoutDetail,
  type WorkbenchAnimationState
} from '../../../src/renderer/src/app/layout/native-layout'

describe('native layout events', () => {
  afterEach(() => vi.restoreAllMocks())

  it('publishes a synchronous final native layout check', () => {
    const listener = vi.fn()
    window.addEventListener(nativeLayoutEvent, listener)

    flushNativeLayout()

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(nativeLayoutEvent, listener)
  })

  it('publishes the live layout phase', () => {
    const phases: Array<NativeLayoutDetail['phase']> = []
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<NativeLayoutDetail>).detail
      phases.push(detail.phase)
    }
    window.addEventListener(nativeLayoutEvent, listener)

    flushNativeLayout({ phase: 'start' })
    flushNativeLayout({ phase: 'end' })

    expect(phases).toEqual(['start', 'end'])
    window.removeEventListener(nativeLayoutEvent, listener)
  })

  it('publishes the complete workbench animation state', () => {
    const states: WorkbenchAnimationState[] = []
    const listener = (event: Event): void => {
      states.push((event as CustomEvent<WorkbenchAnimationState>).detail)
    }
    window.addEventListener(workbenchAnimationEvent, listener)

    notifyWorkbenchAnimation({ animating: true, visible: false })
    notifyWorkbenchAnimation({ animating: false, visible: true })

    expect(states).toEqual([
      { animating: true, visible: false },
      { animating: false, visible: true }
    ])
    window.removeEventListener(workbenchAnimationEvent, listener)
  })
})
