import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { readOwnApiKey, saveOwnApiKey } from './api-key'

/**
 * 由父组件按需挂载，而不是常驻后用 open 控制：挂载即读一次已保存的 Key，
 * 既能保证每次打开都看到最新值，也不用 effect 去同步外部存储。
 */
export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [apiKey, setApiKey] = useState(() => readOwnApiKey())
  const [revealed, setRevealed] = useState(false)

  // 保存语义收敛在存储层：留空 = 清除配置、恢复走账号额度。
  const submit = (): void => {
    saveOwnApiKey(apiKey)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="grid gap-1.5 py-4">
            <span className="text-xs font-medium text-muted-foreground">DeepSeek API Key</span>
            <div className="relative">
              <Input
                autoComplete="off"
                className="pr-9 focus-visible:border-input focus-visible:ring-0"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                spellCheck={false}
                type={revealed ? 'text' : 'password'}
                value={apiKey}
              />
              <button
                aria-label={revealed ? '隐藏 API Key' : '显示 API Key'}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setRevealed((current) => !current)}
                type="button"
              >
                {revealed ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              </button>
            </div>
          </label>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
