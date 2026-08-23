import { lazy, Suspense } from 'react'
import { SquareTerminalIcon } from 'lucide-react'
import type { RendererPlugin } from '@renderer/app/registry/renderer-plugins'
import {
  type WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '@renderer/app/registry/workbench-renderers'
import type { SessionTerminalsState } from '../shared/types'

const TerminalView = lazy(() =>
  import('./terminal-view').then(({ TerminalView }) => ({ default: TerminalView }))
)

const plugin: RendererPlugin = {
  id: 'terminal',
  activate({ registry, subscriptions }) {
    const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
    if (!renderers) throw new Error('Workbench renderer registry is unavailable.')
    subscriptions.push(
      renderers.register('terminal', {
        bindTab: ({ resourceId, sessionId, updateTab }) => {
          let active = true
          void window.bridge
            .invoke('terminal:getState', sessionId)
            .then((payload) => {
              if (!active) return
              const state = payload as SessionTerminalsState
              const terminal = state.terminals.find(({ id }) => id === resourceId)
              if (terminal) updateTab({ title: terminal.title })
            })
            .catch(() => undefined)
          return {
            dispose: () => {
              active = false
            }
          }
        },
        component: (props) => (
          <Suspense fallback={null}>
            <TerminalView {...props} />
          </Suspense>
        ),
        icon: <SquareTerminalIcon aria-hidden className="larify-workbench-icon-terminal" />,
        order: 30,
        title: '终端'
      })
    )
  }
}

export default plugin
