import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { useChat } from "@ai-sdk/react"
import {
  Conversation,
  ConversationContent,
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
import { Spinner } from "@renderer/components/ui/spinner"
import { MessageView } from "./message-view"
import { ipcTransport } from "../lib/transport"

export function AssistantPanel(): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ transport: ipcTransport })
  const isLive = status === "streaming" || status === "submitted"

  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text.trim()
    if (text) void sendMessage({ text })
  }

  const input = (
    <div className="mx-auto w-full max-w-2xl px-4 pb-4">
      <PromptInput
        onSubmit={handleSubmit}
        className="[&_[data-slot=input-group]]:rounded-2xl"
      >
        <PromptInputBody>
          <PromptInputTextarea placeholder="描述任务..." className="max-h-48 min-h-12" />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={status} onStop={() => void stop()} className="rounded-full">
            {isLive ? <SquareIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )

  if (messages.length === 0) {
    return <div className="flex h-full min-w-0 flex-1 flex-col justify-center px-4">{input}</div>
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Conversation className="min-w-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {messages.map((m, i) => (
            <MessageView key={m.id} message={m} streaming={isLive && i === messages.length - 1} />
          ))}
          {status === "submitted" && <Spinner className="text-muted-foreground" />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {input}
    </div>
  )
}
