import { LayoutPanels } from './layout-panels'
import { AssistantSessionsProvider } from '../interaction/assistant/sessions'

export function Layout(): React.JSX.Element {
  return (
    <main className="h-screen overflow-hidden bg-sidebar text-foreground">
      <AssistantSessionsProvider>
        <LayoutPanels />
      </AssistantSessionsProvider>
    </main>
  )
}
