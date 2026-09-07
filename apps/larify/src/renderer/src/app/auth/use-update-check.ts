import { useCallback, useEffect, useState } from 'react'

/** 下载进度（来自 electron-updater 的 download-progress 事件，仅取用 percent）。 */
interface UpdateProgress {
  percent: number
}

interface UpdateCheckResult {
  status?: 'current' | 'available' | 'development'
  version?: string
}

export interface UseUpdateCheck {
  status: string
  progress: UpdateProgress | null
  version: string | null
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
  checkForUpdates: () => Promise<void>
  installUpdate: () => void
}

/** 封装更新检查/下载进度/重启提示的逻辑，供账户菜单渲染使用。 */
export function useUpdateCheck(): UseUpdateCheck {
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // 订阅更新事件：进度条、下载完成弹"重启并安装"、出错提示。
  useEffect(() => {
    const offProgress = window.bridge.on('update:progress', (payload) => {
      setProgress(payload as UpdateProgress)
    })
    const offReady = window.bridge.on('update:ready', (v) => {
      setVersion(typeof v === 'string' ? v : '')
      setProgress(null) // 下载完成，清掉进度条避免残留
      setDialogOpen(true)
    })
    const offError = window.bridge.on('update:error', (message) => {
      setStatus(typeof message === 'string' ? message : '检查失败')
      setProgress(null)
    })

    // 兜底：若挂载前已完成下载（如启动静默检查），直接提示可重启。
    void (window.bridge.invoke('update:downloadedVersion') as Promise<string | null>).then((v) => {
      if (typeof v === 'string' && v) {
        setVersion(v)
        setDialogOpen(true)
      }
    })

    return () => {
      offProgress()
      offReady()
      offError()
    }
  }, [])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    setStatus('检查中…')
    setProgress(null)
    try {
      const result = (await window.bridge.invoke('update:check')) as UpdateCheckResult
      if (result.status === 'available') {
        setStatus(result.version ? `发现 ${result.version}` : '发现新版本')
      } else if (result.status === 'development') {
        setStatus('开发版本')
      } else {
        setStatus('已是最新')
      }
    } catch {
      setStatus('检查失败')
    }
  }, [])

  const installUpdate = useCallback((): void => {
    void window.bridge.invoke('update:install')
  }, [])

  return { status, progress, version, dialogOpen, setDialogOpen, checkForUpdates, installUpdate }
}
