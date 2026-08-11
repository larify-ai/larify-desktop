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

export function BrowserToolbar({ tab, ...props }: BrowserToolbarProps): React.JSX.Element {
  return <BrowserToolbarForTab key={tab?.id ?? 'empty'} tab={tab} {...props} />
}

function BrowserToolbarForTab({
  tab,
  onBack,
  onForward,
  onNavigate,
  onReload
}: BrowserToolbarProps): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigationRevisionRef = useRef(0)
  const url = tab?.url ?? ''
  const displayUrl = simplifyForDisplay(decodeForDisplay(url))
  const editUrl = url.startsWith('file://') ? displayUrl : url
  const isEditing = editing !== null
  const value = editing ?? displayUrl

  useLayoutEffect(() => {
    navigationRevisionRef.current += 1
    return () => {
      navigationRevisionRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 bg-background px-2">
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
              'flex h-8 w-full min-w-0 items-center rounded-md bg-muted px-3 text-left text-sm shadow-none',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
              !tab && 'cursor-not-allowed opacity-50',
              !value && 'text-muted-foreground'
            )}
            data-testid="browser-address"
            disabled={!tab}
            type="button"
            onClick={() => {
              navigationRevisionRef.current += 1
              setEditing(editUrl)
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
            className="h-8 select-text bg-muted shadow-none selection:!bg-primary selection:!text-primary-foreground focus-visible:ring-0"
            data-testid="browser-address"
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
              setEditing(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              const input = event.currentTarget
              const next = input.value
              const revision = ++navigationRevisionRef.current
              const isCurrent = (): boolean => revision === navigationRevisionRef.current
              void onNavigate(next)
                .then((navigated) => {
                  if (navigated && isCurrent()) input.blur()
                })
                .catch(() => undefined)
            }}
          />
        )}
      </div>
    </div>
  )
}
