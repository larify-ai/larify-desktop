export const nativeLayoutEvent = 'larify:native-layout'
export const workbenchAnimationEvent = 'larify:workbench-animation'
export const workbenchStateRequestEvent = 'larify:workbench-state-request'

export interface WorkbenchAnimationState {
  animating: boolean
  visible: boolean
}

export interface NativeLayoutDetail {
  phase: 'start' | 'end'
}

export const flushNativeLayout = (detail?: NativeLayoutDetail): void => {
  window.dispatchEvent(new CustomEvent(nativeLayoutEvent, { detail }))
}

export const notifyWorkbenchAnimation = (state: WorkbenchAnimationState): void => {
  window.dispatchEvent(new CustomEvent(workbenchAnimationEvent, { detail: state }))
}
