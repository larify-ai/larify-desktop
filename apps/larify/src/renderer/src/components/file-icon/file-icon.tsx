import { getFileIcon } from './file-icon-theme'
import './file-icon.css'

interface FileIconProps {
  className?: string
  expanded?: boolean
  kind: 'file' | 'folder'
  light: boolean
  name: string
}

export function FileIcon({
  className = '',
  expanded = false,
  kind,
  light,
  name
}: FileIconProps): React.JSX.Element {
  const icon = getFileIcon(name, kind, expanded, light)
  const classes = `file-icon ${className}`.trim()

  if (icon.url) return <img aria-hidden className={classes} src={icon.url} />

  return (
    <span aria-hidden className={`${classes} file-icon-font`} style={{ color: icon.color }}>
      {icon.character}
    </span>
  )
}
