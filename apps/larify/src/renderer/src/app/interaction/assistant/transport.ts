import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { USAGE_CHANGED_EVENT } from '@shared/events'
import type { AgentModelConfig } from '../../../../../main/core/model/config'
import { readOwnApiKey } from '../../settings/api-key'
import { readMemoryRepo } from '../../settings/memory-repo'
import { invalidateGitStatus } from '../../../../../extensions/workspace/renderer/changes/git-status-invalidation'

function isGitSnapshotChunk(chunk: unknown): boolean {
  return Boolean(
    chunk && typeof chunk === 'object' && (chunk as { type?: unknown }).type === 'data-git-snapshot'
  )
}

function openAgentStream(
  sessionId: string,
  signal: AbortSignal | undefined,
  onTitle: ((title: string) => void) | undefined,
  onGitChange: () => void,
  start: (cancelled: () => boolean, markStarted: () => void) => Promise<void>
): ReadableStream<UIMessageChunk> {
  let finished = false
  let started = false
  let cleanup: Array<() => void> = []

  const dispose = (): void => {
    cleanup.forEach((dispose) => dispose())
    cleanup = []
  }

  return new ReadableStream({
    start(controller) {
      const finish = (error?: unknown): void => {
        if (finished) return
        finished = true
        dispose()
        if (started) onGitChange()
        // A session ended (completed, failed, or aborted): let the account
        // menu refresh the usage balance instead of polling.
        window.dispatchEvent(new CustomEvent(USAGE_CHANGED_EVENT))
        if (error === undefined) controller.close()
        else controller.error(error)
      }

      cleanup.push(
        window.bridge.on(`agent:chunk:${sessionId}`, (chunk) => {
          if (!finished) {
            if (isGitSnapshotChunk(chunk)) onGitChange()
            controller.enqueue(chunk as UIMessageChunk)
          }
        }),
        window.bridge.on(`agent:title:${sessionId}`, (title) => {
          if (!finished && typeof title === 'string') onTitle?.(title)
        }),
        window.bridge.on(`agent:end:${sessionId}`, () => finish()),
        window.bridge.on(`agent:error:${sessionId}`, finish)
      )

      const cancel = (): void => {
        if (!started) return finish()
        void window.bridge.invoke('agent:cancel', sessionId).then(() => finish(), finish)
      }
      if (signal?.aborted) return finish()
      if (signal) {
        signal.addEventListener('abort', cancel)
        cleanup.push(() => signal.removeEventListener('abort', cancel))
      }

      void Promise.resolve()
        .then(() =>
          start(
            () => finished || signal?.aborted === true,
            () => {
              started = true
            }
          )
        )
        .catch(finish)
    },

    async cancel() {
      if (finished) return
      finished = true
      dispose()
      if (!started) return
      try {
        await window.bridge.invoke('agent:cancel', sessionId)
      } finally {
        onGitChange()
        // The stream was abandoned (e.g. the consumer unmounted) after the
        // agent may have consumed usage; refresh the balance here too.
        window.dispatchEvent(new CustomEvent(USAGE_CHANGED_EVENT))
      }
    }
  })
}

/**
 * 用户在设置里配了自有 Key 就带上，主进程据此直连官方、跳过网关。
 *
 * Key 只在真正发请求时挂上去，不会随模型配置一起被 session.tsx
 * 写进模型选择的 localStorage 条目。
 */
function withOwnApiKey(config: AgentModelConfig): AgentModelConfig {
  const apiKey = readOwnApiKey()
  return apiKey ? { ...config, apiKey } : config
}

export function createIpcTransport(
  getCwd: () => string,
  getModelConfig: () => AgentModelConfig,
  onSaved?: () => Promise<void>,
  onTitle?: (title: string) => void
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const message = messages.at(-1)
      if (!message) throw new Error('A message is required.')
      // 「本轮输出该并进哪条 UI 消息」由**渲染端**（唯一知道自己末端的人）显式指定，主进程不再
      // 从数据库反推（反推必错：reset 换库 id、nest 用主链 id ⇒ 猜错就 push 出副本 ⇒ UI 重复）。
      //
      // ⚠️ 只有「末条是 assistant」才给 id（＝本轮要并入它，如 ask_user 回答续写）；末条是刚发的
      // user（新提问）⇒ `undefined` ⇒ 新建一条。**不能**取「最后一条 assistant」——新提问末条是
      // user，若取其前面那条 assistant，会把**新回复并进上一轮的回复**。
      const uiTargetId = message.role === 'assistant' ? message.id : undefined
      const cwd = getCwd()
      const modelConfig = withOwnApiKey(getModelConfig())

      return openAgentStream(
        chatId,
        abortSignal,
        onTitle,
        () => invalidateGitStatus(cwd),
        async (cancelled, markStarted) => {
          const saved = (await window.bridge.invoke('attachment:save', chatId, message)) ?? message
          if (cancelled()) return
          markStarted()
          await window.bridge.invoke('agent:send', {
            sessionId: chatId,
            message: saved,
            cwd,
            modelConfig,
            uiTargetId,
            memoryRepo: readMemoryRepo()
          })
          if (onSaved)
            void Promise.resolve()
              .then(onSaved)
              .catch(() => undefined)
        }
      )
    },

    async reconnectToStream() {
      return null
    }
  }
}
