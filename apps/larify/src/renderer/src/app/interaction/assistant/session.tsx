import { useState } from 'react'
import { Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'

export function AssistantSession({
  id,
  onHeadingChange,
  onSaved
}: {
  id: string
  onHeadingChange: (heading: ConversationHeading | null) => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [{ chat, setTransportCwd }] = useState(() => {
    let transportCwd = ''
    return {
      chat: new Chat<UIMessage>({
        id,
        transport: createIpcTransport(
          () => transportCwd,
          () => readModelConfig(localStorage),
          onSaved
        )
      }),
      setTransportCwd(next: string) {
        transportCwd = next
      }
    }
  })

  const changeCwd = (next: string): void => {
    setTransportCwd(next)
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
