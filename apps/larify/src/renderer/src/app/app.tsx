export function App(): React.JSX.Element {
  return (
    <main className="grid h-screen grid-cols-[16rem_minmax(20rem,1fr)_minmax(20rem,1fr)] overflow-hidden bg-background text-foreground">
      <nav aria-label="Navigation" className="border-r bg-sidebar" />
      <section aria-label="Conversation" className="min-w-0" />
      <aside aria-label="Workspace" className="min-w-0 border-l" />
    </main>
  )
}
