import type { SVGProps } from 'react'

export function WorkspaceIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="3" width="20" height="18" rx="3" />
      <path d="M8 3v18M12 7h5M14 11h4M14 15h4M12 18h5" />
    </svg>
  )
}
