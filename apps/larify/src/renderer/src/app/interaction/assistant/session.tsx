import { useState } from 'react'
import { Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'

export function AssistantSession(): React.JSX.Element {
  const [chat] = useState(
    () =>
      new Chat<UIMessage>({
        id: crypto.randomUUID(),
        messages: [],
        transport: createIpcTransport(
          () => '',
          () => readModelConfig(localStorage)
        )
      })
  )

  return <AssistantChat chat={chat} />
}
