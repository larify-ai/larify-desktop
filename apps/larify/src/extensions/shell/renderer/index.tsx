import type { Extension } from 'kernel'
import type { View } from '@renderer/types/view'
import { Shell } from './components/shell'

const extension: Extension = {
  activate(app) {
    app.register('view', 'root', { render: () => <Shell app={app} /> } satisfies View)
  }
}

export default extension
