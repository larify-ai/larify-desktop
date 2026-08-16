export const nativeLayoutEvent = 'larify:native-layout'
export const workbenchAnimationEvent = 'larify:workbench-animation'
export const workbenchStateRequestEvent = 'larify:workbench-state-request'

export interface WorkbenchAnimationState {
  animating: boolean
  visible: boolean
}

export const notifyNativeLayout = (): void => {
  window.dispatchEvent(new Event(nativeLayoutEvent))
}

export const notifyWorkbenchAnimation = (state: WorkbenchAnimationState): void => {
  window.dispatchEvent(new CustomEvent(workbenchAnimationEvent, { detail: state }))
}
