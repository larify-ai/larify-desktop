import type { Extension } from 'kernel'
import { SettingsIcon } from 'lucide-react'
import type { View } from '@renderer/types/view'
import { SettingsPane } from './components/settings-pane'

const extension: Extension = {
  activate(app) {
    app.register('view', 'settings', {
      sidebar: {
        icon: SettingsIcon,
        id: 'settings',
        label: '设置',
        order: 100,
        placement: 'footer'
      },
      render: () => <SettingsPane />
    } satisfies View)
  }
}

export default extension
