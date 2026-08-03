import {
  convertToModelMessages,
  readUIMessageStream,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import { runAgent, type AgentOutput } from './agent'

interface AgentSessionResult<OUTPUT extends AgentOutput> {
  result: ReturnType<typeof runAgent<OUTPUT>>
  messages: Promise<UIMessage[]>
  latest: () => UIMessage[]
}

function appendResponse(messages: UIMessage[], response: UIMessage): UIMessage[] {
  return messages.at(-1)?.id === response.id
    ? [...messages.slice(0, -1), response]
    : [...messages, response]
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

  let latest = messages
  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    onEnd: ({ messages }) => {
      latest = messages
    }
  })
  const [updates, chunks] = stream.tee()
  const completed = Promise.all([
    (async () => {
      for await (const response of readUIMessageStream({ stream: updates })) {
        latest = appendResponse(messages, response)
      }
    })(),
    chunks.pipeTo(new WritableStream({ write: onChunk }))
  ]).then(() => latest)

  return { result, messages: completed, latest: () => latest }
}
