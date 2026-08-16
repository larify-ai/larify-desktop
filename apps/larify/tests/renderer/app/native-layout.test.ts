// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nativeLayoutEvent,
  notifyNativeLayout,
  notifyWorkbenchAnimation,
  workbenchAnimationEvent,
  type WorkbenchAnimationState
} from '../../../src/renderer/src/app/layout/native-layout'

describe('native layout events', () => {
  afterEach(() => vi.restoreAllMocks())

  it('dispatches every native layout notification synchronously', () => {
    const listener = vi.fn()
    window.addEventListener(nativeLayoutEvent, listener)

    notifyNativeLayout()
    notifyNativeLayout()

    expect(listener).toHaveBeenCalledTimes(2)
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
