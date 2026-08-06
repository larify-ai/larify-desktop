import { Region } from '../layout/region'

export function Workbench(): React.JSX.Element {
  return (
    <Region label="Workbench" className="h-full min-w-0 overflow-hidden">
      <aside aria-label="Workbench content" className="h-full" />
    </Region>
  )
}
