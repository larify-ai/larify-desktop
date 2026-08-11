import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { BrowserTabState } from '../shared/types'

interface BrowserToolbarProps {
  tab: BrowserTabState | null
  onBack(): void
  onForward(): void
  onNavigate(url: string): Promise<boolean>
  onReload(): void
}

const decodeForDisplay = (url: string): string => {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

const displayFileUrl = (url: URL): string => {
  const path = decodeURIComponent(url.pathname)
  return path.length >= 3 && path[0] === '/' && path[2] === ':' ? path.slice(1) : path
}

const simplifyForDisplay = (url: string): string => {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return displayFileUrl(parsed)
    const prefix = `${parsed.protocol}//`
    return url.startsWith(prefix) ? url.slice(prefix.length) : url
  } catch {
    return url
  }
}

export function BrowserToolbar({
  tab,
  onBack,
  onForward,
  onNavigate,
  onReload
}: BrowserToolbarProps): React.JSX.Element {
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigationRevisionRef = useRef(0)
  const fullUrl = tab ? decodeForDisplay(tab.url) : ''
  const displayUrl = simplifyForDisplay(fullUrl)
  const editUrl = fullUrl.startsWith('file://') ? displayUrl : fullUrl
  const tabKey = tab ? `${tab.id}:${tab.url}` : ''
  const tabKeyRef = useRef(tabKey)
  const isEditing = editing?.key === tabKey
  const value = isEditing ? editing.value : displayUrl

  useLayoutEffect(() => {
    tabKeyRef.current = tabKey
    navigationRevisionRef.current += 1
  }, [tabKey])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 bg-card px-2">
      <Button
        aria-label="后退"
        disabled={!tab?.canGoBack}
        onClick={onBack}
        size="icon-sm"
        variant="ghost"
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        aria-label="前进"
        disabled={!tab?.canGoForward}
        onClick={onForward}
        size="icon-sm"
        variant="ghost"
      >
        <ArrowRightIcon />
      </Button>
      <Button aria-label="刷新" disabled={!tab} onClick={onReload} size="icon-sm" variant="ghost">
        <RotateCwIcon className={cn(tab?.loading && 'animate-spin')} />
      </Button>
      <div className="relative min-w-0 flex-1">
        {!isEditing ? (
          <button
            className={cn(
              'flex h-8 w-full min-w-0 items-center rounded-md bg-muted/40 px-3 text-left text-sm shadow-none',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
              !tab && 'cursor-not-allowed opacity-50',
              !value && 'text-muted-foreground'
            )}
            disabled={!tab}
            type="button"
            onClick={() => {
              navigationRevisionRef.current += 1
              setEditing({ key: tabKey, value: editUrl })
            }}
          >
            <span className="truncate">{value || '输入 URL'}</span>
          </button>
        ) : (
          <Input
            ref={inputRef}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-8 select-text bg-muted/40 shadow-none focus-visible:ring-0"
            disabled={!tab}
            placeholder="输入 URL"
            spellCheck={false}
            value={value}
            onBlur={() => {
              navigationRevisionRef.current += 1
              setEditing(null)
            }}
            onChange={(event) => {
              navigationRevisionRef.current += 1
              setEditing({ key: tabKey, value: event.target.value })
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const input = event.currentTarget
              const next = input.value
              const revision = ++navigationRevisionRef.current
              const isCurrent = (): boolean =>
                revision === navigationRevisionRef.current && tabKeyRef.current === tabKey
              void onNavigate(next)
                .then((navigated) => {
                  if (!isCurrent()) return
                  if (navigated) input.blur()
                  else setEditing({ key: tabKey, value: next })
                })
                .catch(() => {
                  if (isCurrent()) setEditing({ key: tabKey, value: next })
                })
            }}
          />
        )}
      </div>
    </div>
  )
}
