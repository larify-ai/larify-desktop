import { lazy, Suspense } from 'react'
import type { Extension } from '@shared/extension'
import { SquareTerminalIcon } from 'lucide-react'
import type { View } from '@renderer/types/view'

let terminalViewPromise: Promise<{
  default: typeof import('./terminal-view').TerminalView
}> | null = null

const loadTerminalView = (): NonNullable<typeof terminalViewPromise> => {
  terminalViewPromise ??= import('./terminal-view')
    .then(({ TerminalView }) => ({ default: TerminalView }))
    .catch((error) => {
      terminalViewPromise = null
      throw error
    })
  return terminalViewPromise
}

const TerminalView = lazy(loadTerminalView)

const extension: Extension = {
  activate(app, context) {
    app.register('view', 'terminal', {
      sidebar: {
        icon: SquareTerminalIcon,
        id: 'terminal',
        label: '终端',
        order: 10,
        placement: 'content'
      },
      render: () => (
        <Suspense fallback={null}>
          <TerminalView />
        </Suspense>
      )
    } satisfies View)
  }
}

export default extension
