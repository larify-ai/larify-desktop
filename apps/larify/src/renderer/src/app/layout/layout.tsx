import { LayoutPanels } from './layout-panels'

export function Layout(): React.JSX.Element {
  return (
    <main className="h-screen overflow-hidden bg-sidebar text-foreground">
      <LayoutPanels />
    </main>
  )
}
