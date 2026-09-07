import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const accountMenu = readFileSync(resolve('src/renderer/src/app/auth/account-menu.tsx'), 'utf8')

describe('AccountMenu', () => {
  it('places 设置 above 检查更新 and mounts SettingsDialog on demand', () => {
    expect(accountMenu).toContain("import { SettingsDialog } from '../settings/settings-dialog'")
    expect(accountMenu).toContain('<SettingsIcon')
    expect(accountMenu).toContain('window.setTimeout(() => setSettingsOpen(true), 0)')
    expect(accountMenu).toContain('>设置</span>')
    // 顺序：设置项必须出现在「检查更新」之前。
    expect(accountMenu.indexOf('>设置</span>')).toBeLessThan(
      accountMenu.indexOf('>检查更新</span>')
    )
    // 设置弹窗按需挂载（打开才渲染），不常驻。
    expect(accountMenu).toContain(
      '{settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}'
    )
  })

  it('matches the menu width to its trigger and confirms before logging out', () => {
    expect(accountMenu).toContain('w-[var(--radix-dropdown-menu-trigger-width)]')
    expect(accountMenu).toContain('<DialogTitle>确认退出登录</DialogTitle>')
    expect(accountMenu).toContain('await logout()')
    expect(accountMenu).not.toContain('variant="destructive"')
    expect(accountMenu).toContain('aria-label="套餐与账户菜单"')
    expect(accountMenu).toContain("email ?? '登录邮箱'")
    // The trigger renders live data: plan title + remaining ratio + progress.
    expect(accountMenu).toContain('{planTitle}')
    expect(accountMenu).toContain('remainingRatio')
    expect(accountMenu).toContain("invoke('model-api:get-balance')")
    expect(accountMenu).toContain('>主题</span>')
    expect(accountMenu).toContain("setTheme('light')")
    expect(accountMenu).toContain("setTheme('dark')")
    // 更新逻辑封装在 useUpdateCheck hook，组件只做渲染。
    expect(accountMenu).toContain("import { useUpdateCheck } from './use-update-check'")
    expect(accountMenu).toContain('const update = useUpdateCheck()')
    expect(accountMenu).toContain('>重启并安装</Button>')
    // The dropdown was simplified back to the legacy structure: no subscription
    // blocks, no manual credential/refresh buttons inside the menu.
    expect(accountMenu).not.toContain('获取凭据')
    expect(accountMenu).not.toContain('剩余额度')
    expect(accountMenu).not.toContain('有效期至')
    expect(accountMenu).not.toContain('RefreshCwIcon')
  })
})
