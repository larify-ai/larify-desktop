import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const accountMenu = readFileSync(
  resolve('src/renderer/src/app/auth/account-menu.tsx'),
  'utf8'
)

describe('AccountMenu', () => {
  it('matches the menu width to its trigger and confirms before logging out', () => {
    expect(accountMenu).toContain('w-[var(--radix-dropdown-menu-trigger-width)]')
    expect(accountMenu).toContain('<DialogTitle>确认退出登录</DialogTitle>')
    expect(accountMenu).toContain('await logout()')
    expect(accountMenu).not.toContain('variant="destructive"')
    expect(accountMenu).toContain('aria-label="套餐与账户菜单"')
    expect(accountMenu).toContain("email ?? '登录邮箱'")
    expect(accountMenu).toContain('>体验版</span>')
    expect(accountMenu).toContain('>使用量</span>')
    expect(accountMenu).toContain('剩余 100%')
    expect(accountMenu).toContain('>主题</span>')
    expect(accountMenu).toContain("setTheme('light')")
    expect(accountMenu).toContain("setTheme('dark')")
    expect(accountMenu).toContain("window.bridge.invoke('update:check')")
  })
})
