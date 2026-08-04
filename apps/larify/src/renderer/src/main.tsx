import './assets/main.css'
import { createRoot } from 'react-dom/client'
import { createApp, Loader } from '@shared/extension'
import type { Extension } from '@shared/extension'
import type { View } from '@renderer/types/view'
import { discoverExtensions } from '../../shared/discover-extensions'

const modules = import.meta.glob<{ default: Extension }>('../../extensions/*/renderer/index.tsx')
const { extensions, loaders } = discoverExtensions(modules)

async function boot(): Promise<void> {
  const element = document.getElementById('root')
  if (!element) throw new Error('Renderer root element is missing')
  const root = createRoot(element)

  try {
    const host = createApp()
    const loader = new Loader(host, (m) => loaders.get(m.id)!())
    await loader.loadAll(extensions)

    const view = host.get<View>('view', 'root')
    if (!view) throw new Error('Root view is not registered')
    root.render(view.render())
  } catch (error) {
    console.error('[renderer:boot]', error)
    root.render(
      <main className="grid h-screen place-items-center bg-background px-6 text-center text-foreground">
        <div className="space-y-1">
          <h1 className="text-sm font-medium">应用启动失败</h1>
          <p className="text-xs text-muted-foreground">
            请重新启动应用；如果问题仍然存在，请查看日志。
          </p>
        </div>
      </main>
    )
  }
}

void boot()

document.addEventListener('mousedown', (e) => {
  const target = e.target as Element | null
  if (!target?.closest?.('.select-text')) {
    window.getSelection()?.removeAllRanges()
  }
})
