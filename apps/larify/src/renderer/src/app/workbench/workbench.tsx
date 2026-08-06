import { Region } from '../layout/region'

export function Workbench(): React.JSX.Element {
  return (
    <Region label="Workbench" className="h-full min-w-[320px]">
      <aside aria-label="Workbench content" className="h-full" />
    </Region>
  )
}
