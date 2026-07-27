import type { SVGProps } from 'react'

export function ChangesIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 24 24"
      {...props}
    >
      <rect height="18" rx="3" width="18" x="3" y="3" />
      <path d="M9 10h6M12 7v6M9 17h6" />
    </svg>
  )
}
