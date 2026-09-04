import { useCallback, useEffect, useState } from 'react'
import {
  CircleArrowUpIcon,
  CrownIcon,
  LogOutIcon,
  PaletteIcon,
  SettingsIcon,
  UserRoundIcon
} from 'lucide-react'
import { useTheme } from 'next-themes'

import type { ModelApiBalance } from '@shared/model-api'
import { USAGE_CHANGED_EVENT } from '@shared/events'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useAuth } from './auth-context'
import { SettingsDialog } from '../settings/settings-dialog'

export function AccountMenu(): React.JSX.Element {
  const { email, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const [confirming, setConfirming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [balance, setBalance] = useState<ModelApiBalance | null>(null)
  const [balanceError, setBalanceError] = useState('')

  const refreshBalance = useCallback(async (): Promise<void> => {
    setBalanceError('')
    try {
      const result = (await window.bridge.invoke('model-api:get-balance')) as ModelApiBalance
      setBalance(result)
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : '加载额度失败')
    }
  }, [])

  // Fetch once on mount for an initial value, then refresh whenever an agent
  // session ends (the transport dispatches USAGE_CHANGED_EVENT) or the window
  // regains focus (covers purchases/plan changes made elsewhere). No polling:
  // the balance only changes through model usage or external actions. The
  // initial fetch is deferred to a timer so the effect never synchronously
  // calls setState (avoids cascading renders per the react-hooks rules).
  useEffect(() => {
    const initial = setTimeout(() => void refreshBalance(), 0)
    const refresh = (): void => {
      void refreshBalance()
    }
    window.addEventListener(USAGE_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(initial)
      window.removeEventListener(USAGE_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [refreshBalance])

  const subscription = balance?.subscriptions?.[0]
  const planTitle = subscription?.planTitle ?? '未开通'
  const remaining = subscription && subscription.total > 0
    ? Math.max(0, subscription.total - subscription.used)
    : 0
  const remainingRatio = subscription && subscription.total > 0
    ? Math.min(1, remaining / subscription.total)
    : 0

  const checkForUpdates = async (): Promise<void> => {
    setUpdateStatus('检查中…')
    try {
      const result = (await window.bridge.invoke('update:check')) as {
        status?: 'current' | 'available' | 'development'
        version?: string
      }
      if (result.status === 'available') {
        setUpdateStatus(result.version ? `发现 ${result.version}` : '发现新版本')
      } else if (result.status === 'development') {
        setUpdateStatus('开发版本')
      } else {
        setUpdateStatus('已是最新')
      }
    } catch {
      setUpdateStatus('检查失败')
    }
  }

  const confirmLogout = async (): Promise<void> => {
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
      setConfirming(false)
    } catch {
      setLogoutError('退出登录失败，请重试。')
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="套餐与账户菜单"
            className="mx-1 grid h-14 w-[calc(100%-0.5rem)] grid-cols-[minmax(0,1fr)_auto] content-center gap-x-2 gap-y-1.5 rounded-lg px-2 text-left text-sm text-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <CrownIcon aria-hidden="true" className="size-4 shrink-0 stroke-[1.75]" />
              <span className="truncate">{planTitle}</span>
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {subscription ? `剩余 ${Math.round(remainingRatio * 100)}%` : balanceError ? '—' : '···'}
            </span>
            <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground transition-all"
                style={{ width: `${remainingRatio * 100}%` }}
              />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-[var(--radix-dropdown-menu-trigger-width)] rounded-2xl border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur"
        >
          <div className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-sm">
            <UserRoundIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="truncate" title={email ?? undefined}>
              {email ?? '登录邮箱'}
            </span>
          </div>

          <DropdownMenuSeparator className="my-2" />
          <div className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-sm">
            <PaletteIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="min-w-12 whitespace-nowrap">主题</span>
            <span className="flex justify-self-end rounded-md bg-muted p-0.5">
              <button
                type="button"
                aria-pressed={resolvedTheme === 'light'}
                className={`rounded px-2 py-1 text-xs ${resolvedTheme === 'light' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setTheme('light')
                }}
              >
                浅色
              </button>
              <button
                type="button"
                aria-pressed={resolvedTheme === 'dark'}
                className={`rounded px-2 py-1 text-xs ${resolvedTheme === 'dark' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setTheme('dark')
                }}
              >
                深色
              </button>
            </span>
          </div>
          <DropdownMenuItem
            className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] gap-2 rounded-lg px-2 text-sm"
            onSelect={() => {
              // 等下拉菜单收起再开弹窗，否则两层浮层会互相抢焦点。
              window.setTimeout(() => setSettingsOpen(true), 0)
            }}
          >
            <SettingsIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="min-w-16 whitespace-nowrap">设置</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] gap-2 rounded-lg px-2 text-sm"
            onSelect={(event) => {
              event.preventDefault()
              void checkForUpdates()
            }}
          >
            <CircleArrowUpIcon
              aria-hidden="true"
              className={`size-5 stroke-[1.75] text-foreground ${updateStatus === '检查中…' ? 'animate-spin' : ''}`}
            />
            <span className="min-w-16 whitespace-nowrap">检查更新</span>
            {updateStatus && (
              <span className="col-start-3 w-full whitespace-nowrap text-right text-xs text-muted-foreground">
                {updateStatus}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-2" />
          <DropdownMenuItem
            className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] gap-2 rounded-lg px-2 text-sm"
            onSelect={() => setConfirming(true)}
          >
            <LogOutIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="min-w-16 whitespace-nowrap">退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 只在打开时挂载：每次展开都重新读一次已保存的 Key，省去 effect 同步。 */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      <Dialog open={confirming} onOpenChange={(open) => !isLoggingOut && setConfirming(open)}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认退出登录</DialogTitle>
            <DialogDescription>退出登录会停止正在执行的任务</DialogDescription>
          </DialogHeader>
          {logoutError && <p className="mt-3 text-sm text-destructive">{logoutError}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isLoggingOut}
              onClick={() => setConfirming(false)}
              className="focus-visible:ring-0 focus-visible:border-input dark:focus-visible:border-input"
            >
              取消
            </Button>
            <Button disabled={isLoggingOut} onClick={() => void confirmLogout()}>
              {isLoggingOut ? '正在退出…' : '确认退出'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
