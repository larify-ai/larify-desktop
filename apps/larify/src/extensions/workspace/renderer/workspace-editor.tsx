import { useEffect, useRef } from 'react'
import { renderEditorPart } from '@codingame/monaco-vscode-views-service-override'
import {
  layoutWorkspaceEditor,
  monacoReady
} from './monaco'
import { WorkspaceEmptyState } from './workspace-empty-state'

interface WorkspaceEditorProps {
  activeFile: string | null
  onReady(): void
  onReveal(path: string): void
  root: string | null
}

function breadcrumbPath(root: string, file: string, index: number): string | null {
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const relative = file.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  if (
    index < 0 ||
    !file
      .toLowerCase()
      .startsWith(`${normalizedRoot.toLowerCase()}${root.includes('\\') ? '\\' : '/'}`)
  ) {
    return null
  }
  const parts = relative.split(/[\\/]/).filter(Boolean)
  if (index >= parts.length) return null
  const separator = root.includes('\\') ? '\\' : '/'
  return `${normalizedRoot}${separator}${parts.slice(0, index + 1).join(separator)}`
}

function rootName(root: string): string {
  return (
    root
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? root
  )
}

function prependWorkspaceRoot(container: Element, root: string): boolean {
  let found = false
  for (const breadcrumbs of container.querySelectorAll('.monaco-breadcrumbs')) {
    if (breadcrumbs.querySelector(':scope > .workspace-root-breadcrumb')) {
      found = true
      continue
    }
    const firstItem = breadcrumbs.querySelector(':scope > .monaco-breadcrumb-item')
    if (!firstItem) continue

    const item = firstItem.cloneNode(true) as HTMLElement
    item.classList.add('workspace-root-breadcrumb')
    item.querySelector('.label-name')?.replaceChildren(rootName(root))
    item.querySelector('.monaco-icon-label')?.setAttribute('aria-label', rootName(root))
    breadcrumbs.insertBefore(item, firstItem)
    found = true
  }
  return found
}

export function WorkspaceEditor({
  activeFile,
  onReady,
  onReveal,
  root
}: WorkspaceEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let disposePart: (() => void) | undefined
    void monacoReady
      .then(() => {
        const container = containerRef.current
        if (disposed || !container) return
        container.replaceChildren()
        const suppressTabHover = (event: MouseEvent): void => {
          if ((event.target as Element).closest('.tabs-container > .tab')) {
            event.stopPropagation()
          }
        }
        container.addEventListener('mouseover', suppressTabHover, true)
        const part = renderEditorPart(container)
        let layoutFrame = 0
        const layout = (): void => {
          cancelAnimationFrame(layoutFrame)
          layoutFrame = requestAnimationFrame(() => void layoutWorkspaceEditor())
        }
        const resizeObserver = new ResizeObserver(() => {
          layout()
        })
        resizeObserver.observe(container)
        layout()
        onReady()
        disposePart = () => {
          cancelAnimationFrame(layoutFrame)
          resizeObserver.disconnect()
          container.removeEventListener('mouseover', suppressTabHover, true)
          part.dispose()
        }
      })
      .catch((error) => console.error('[workspace:editor]', error))
    return () => {
      disposed = true
      disposePart?.()
    }
  }, [onReady])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !activeFile || !root) return
    let frame = 0
    let attempts = 0
    const prependRoot = (): void => {
      if (prependWorkspaceRoot(container, root) || attempts >= 4) return
      attempts += 1
      frame = requestAnimationFrame(prependRoot)
    }
    prependRoot()
    const breadcrumbItem = (event: Event): Element | null =>
      (event.target as Element).closest('.monaco-breadcrumb-item')
    const revealBreadcrumb = (event: MouseEvent): void => {
      const item = breadcrumbItem(event)
      if (!item || !container.contains(item)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type !== 'mousedown') return
      if (item.classList.contains('workspace-root-breadcrumb')) {
        onReveal(root)
        return
      }
      const siblings = item.parentElement?.querySelectorAll(
        '.monaco-breadcrumb-item:not(.workspace-root-breadcrumb)'
      )
      if (!siblings) return
      const path = breadcrumbPath(root, activeFile, [...siblings].indexOf(item))
      if (!path) return
      onReveal(path)
    }
    container.addEventListener('mousedown', revealBreadcrumb, true)
    container.addEventListener('click', revealBreadcrumb, true)
    return () => {
      cancelAnimationFrame(frame)
      container.querySelectorAll('.workspace-root-breadcrumb').forEach((item) => item.remove())
      container.removeEventListener('mousedown', revealBreadcrumb, true)
      container.removeEventListener('click', revealBreadcrumb, true)
    }
  }, [activeFile, onReveal, root])

  return (
    <div className="workspace-editor relative h-full min-h-0 w-full">
      <div ref={containerRef} className="h-full min-h-0 w-full" />
      {!activeFile ? (
        <div className="absolute inset-0">
          <WorkspaceEmptyState />
        </div>
      ) : null}
    </div>
  )
}
