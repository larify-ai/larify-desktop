import { useState } from 'react'
import {
  CircleArrowUpIcon,
  CrownIcon,
  LogOutIcon,
  PaletteIcon,
  UserRoundIcon
} from 'lucide-react'
import { useTheme } from 'next-themes'

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

export function AccountMenu(): React.JSX.Element {
  const { email, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const [confirming, setConfirming] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [logoutError, setLogoutError] = useState('')

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
      // Logout failed (e.g. an IPC error): stay signed in and surface the
      // failure so the user can retry from the still-open confirm dialog.
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
              <span className="truncate">体验版</span>
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">剩余 100%</span>
            <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full w-full rounded-full bg-foreground" />
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
          {/* <DropdownMenuSeparator className="my-2" />
          <div className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-sm">
            <CrownIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="min-w-12 whitespace-nowrap">体验版</span>
            <button
              type="button"
              className="justify-self-end rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background hover:opacity-90"
            >
              升级
            </button>
          </div>
          <div className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-sm">
            <GaugeIcon aria-hidden="true" className="size-5 stroke-[1.75] text-foreground" />
            <span className="min-w-12 whitespace-nowrap">使用量</span>
            <span className="col-start-3 w-full whitespace-nowrap text-right text-xs text-muted-foreground">
              剩余 100%
            </span>
          </div> */}
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
