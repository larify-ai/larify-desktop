import { useState } from 'react'
import { Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'

export function AssistantSession({
  onHeadingChange
}: {
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [{ chat, updateCwd }] = useState(() => {
    let currentCwd = ''
    return {
      chat: new Chat<UIMessage>({
        id: crypto.randomUUID(),
        messages: [],
        transport: createIpcTransport(
          () => currentCwd,
          () => readModelConfig(localStorage)
        )
      }),
      updateCwd(next: string) {
        currentCwd = next
      }
    }
  })

  const changeCwd = (next: string): void => {
    updateCwd(next)
    setCwd(next)
  }

  return (
    <AssistantChat
      chat={chat}
      cwd={cwd}
      onCwdChange={changeCwd}
      onHeadingChange={onHeadingChange}
    />
  )
}
