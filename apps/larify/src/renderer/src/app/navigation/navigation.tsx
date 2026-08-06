import { Region } from '../layout/region'

export function Navigation(): React.JSX.Element {
  return (
    <Region label="Navigation" className="h-full bg-sidebar">
      <nav aria-label="Tasks" className="h-full" />
    </Region>
  )
}
