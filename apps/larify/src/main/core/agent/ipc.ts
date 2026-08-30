import { ipcMain } from 'electron'
import type { Disposable } from '@shared/infra/disposable'
import { errorMessage } from '../../utils/error'
import { Agent, type AgentInput } from './agent'

export function registerAgentHandlers(agent: Agent): Disposable {
  ipcMain.handle('agent:send', (event, input: AgentInput) => {
    const channel = input.sessionId
    // 首次发送失败即渲染侧已销毁（窗口关闭/刷新），后续 chunk 直接丢弃，不再重复尝试。
    let disposed = false
    const send = (name: string, ...args: unknown[]): void => {
      if (disposed) return
      // webContents.isDestroyed() 只能挡住 WebContents 已销毁；窗口关闭/页面刷新
      // 时 frame（webFrameMain）先被 dispose，webContents.send 底层会抛
      // 「Render frame was disposed before WebFrameMain could be accessed」。
      // 接收方已不在，消息丢弃即可，不能让它冒泡成未处理的运行时错误。
      try {
        if (event.sender.isDestroyed()) disposed = true
        else event.sender.send(name, ...args)
      } catch {
        disposed = true
      }
    }
    return agent.send(input, {
      chunk: (chunk) => send(`agent:chunk:${channel}`, chunk),
      title: (title) => send(`agent:title:${channel}`, title),
      error: (error) => send(`agent:error:${channel}`, errorMessage(error)),
      end: () => send(`agent:end:${channel}`)
    })
  })

  ipcMain.handle('agent:cancel', (_event, sessionId: string) => agent.cancel(sessionId))

  return {
    dispose() {
      ipcMain.removeHandler('agent:send')
      ipcMain.removeHandler('agent:cancel')
    }
  }
}
