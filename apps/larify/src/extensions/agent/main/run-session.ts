import {
  convertToModelMessages,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import { runAgent, type AgentOutput } from './agent'

interface AgentSessionResult<OUTPUT extends AgentOutput> {
  result: ReturnType<typeof runAgent<OUTPUT>>
  messages: Promise<UIMessage[]>
}

export async function runAgentSession<OUTPUT extends AgentOutput = AgentOutput>(
  messages: UIMessage[],
  options: Omit<Parameters<typeof runAgent<OUTPUT>>[0], 'messages'>,
  onChunk?: (chunk: UIMessageChunk) => void
): Promise<AgentSessionResult<OUTPUT>> {
  const result = runAgent({
    ...options,
    messages: await convertToModelMessages(messages)
  })

  const completed = new Promise<UIMessage[]>((resolve, reject) => {
    const stream = toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onEnd: ({ messages }) => resolve(messages)
    })
    void stream.pipeTo(new WritableStream({ write: onChunk })).catch(reject)
  })

  return { result, messages: completed }
}
