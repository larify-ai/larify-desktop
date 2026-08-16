// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WorkbenchTabActionsContext,
  WorkbenchTabActionScope,
  useWorkbenchTabActions
} from '../../../../src/renderer/src/app/workbench/workbench-tab-actions'

describe('workbench tab actions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
  })

  it('registers, updates, and clears an action', async () => {
    await act(async () => root.render(createElement(Harness, { label: 'first' })))
    expect(container.textContent).toBe('first')

    await act(async () => root.render(createElement(Harness, { label: 'second' })))
    expect(container.textContent).toBe('second')

    await act(async () => root.render(createElement(ActionHost)))
    expect(container.textContent).toBe('')
  })

  it('ignores actions from an inactive scope', async () => {
    await act(async () => root.render(createElement(Harness, { active: false, label: 'hidden' })))
    expect(container.textContent).toBe('')

    await act(async () => root.render(createElement(Harness, { active: true, label: 'visible' })))
    expect(container.textContent).toBe('visible')
  })

  it('does nothing outside a tab actions provider', async () => {
    await act(async () => root.render(createElement(Action, { label: 'unused' })))
    expect(container.textContent).toBe('')
  })
})

function Harness({ active = true, label }: { active?: boolean; label: string }): React.JSX.Element {
  return createElement(
    ActionHost,
    null,
    createElement(WorkbenchTabActionScope, { active }, createElement(Action, { label }))
  )
}

function ActionHost({ children }: { children?: ReactNode }): React.JSX.Element {
  const [action, setAction] = useState<ReactNode>(null)
  return createElement(WorkbenchTabActionsContext.Provider, { value: setAction }, action, children)
}

function Action({ label }: { label: string }): null {
  useWorkbenchTabActions(createElement('span', null, label))
  return null
}
