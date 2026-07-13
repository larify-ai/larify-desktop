import { useChat } from "@ai-sdk/react"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@renderer/components/ai-elements/conversation"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@renderer/components/ai-elements/prompt-input"
import { MessageView } from "./message-view"
import { ipcTransport } from "../lib/transport"

export function AssistantPanel(): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ transport: ipcTransport })
  const isLive = status === "streaming" || status === "submitted"

  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text.trim()
    if (text) void sendMessage({ text })
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Conversation className="min-w-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="开始对话"
              description="问点什么，比如「扫描 I2C 总线 1」"
            />
          ) : (
            messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                streaming={isLive && i === messages.length - 1}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-2xl p-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="发消息…" />
          </PromptInputBody>
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={() => void stop()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
