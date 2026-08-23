import { describe, expect, it } from 'vitest'
import { isToolUIPart, type UIMessage } from 'ai'
import { buildAssistantRenderItems } from '../../../../../src/renderer/src/app/interaction/assistant/message-render-items'
import { isVisibleToolPart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/tool-visibility'

const message = (...parts: UIMessage['parts']): UIMessage => ({
  id: 'assistant',
  role: 'assistant',
  parts
})

const timedMessage = (...parts: UIMessage['parts']): UIMessage => ({
  ...message(...parts),
  metadata: { startedAt: 1_000, completedAt: 329_000 }
})

const tool = (
  id: string,
  title: string,
  state: 'input-available' | 'output-available' = 'output-available',
  name = 'read_file',
  icon?: string
): UIMessage['parts'][number] => ({
  type: 'dynamic-tool',
  toolName: name,
  toolCallId: id,
  state,
  input: { toolCallTitle: title },
  toolMetadata: icon ? { icon } : undefined,
  ...(state === 'output-available' ? { output: 'done' } : {})
})

describe('assistant message render items', () => {
  it('renders Markdown reasoning summaries as plain text', () => {
    const items = buildAssistantRenderItems(
      message({
        type: 'reasoning',
        text: '### 步骤 1：**预期**：读取 `schema`，查看 [官方文档](https://example.com)。'
      }),
      false
    )

    expect(items[0].children?.[0]).toEqual(
      expect.objectContaining({ summary: '步骤 1：预期：读取 schema，查看 官方文档。' })
    )
  })

  it('ignores non-assistant messages and assistant file parts', () => {
    const userMessage = { ...message({ type: 'text', text: 'hello' }), role: 'user' } as UIMessage
    const assistantFile = message({
      type: 'file',
      mediaType: 'text/plain',
      filename: 'result.txt',
      url: 'data:text/plain,result'
    })

    expect(buildAssistantRenderItems(userMessage, false)).toEqual([])
    expect(buildAssistantRenderItems(assistantFile, false)).toEqual([])
  })

  it('shows a timed status for an otherwise empty completed assistant message', () => {
    const empty = { ...message(), metadata: { startedAt: 1_000, completedAt: 2_000 } } as UIMessage

    expect(buildAssistantRenderItems(empty, false)).toEqual([
      expect.objectContaining({ kind: 'status', summary: '已完成 · 处理了 1秒' })
    ])
  })

  it('falls back to the tool name when no call title is available', () => {
    const unnamed: UIMessage['parts'][number] = {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'read',
      state: 'output-available',
      input: {},
      output: 'done'
    }

    const items = buildAssistantRenderItems(message(unnamed), false)

    expect(items[0].children?.[0].summary).toBe('read_file')
  })

  it('keeps a standalone ask-user request directly visible without requiring timing metadata', () => {
    const items = buildAssistantRenderItems(
      message(tool('ask', 'Choose one', 'input-available', 'agent_ask_user')),
      false
    )

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'pending-ask-user',
        summary: 'Choose one',
        defaultOpen: true
      })
    ])
  })

  it('keeps text after the last tool fully rendered', () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'intermediate **markdown**' },
      tool('1', 'Read source'),
      { type: 'text', text: 'final [answer](README.md)' }
    ]
    const items = buildAssistantRenderItems(message(...parts), false)

    expect(items.map((item) => item.kind)).toEqual(['activity-group', 'final-text'])
    expect(items[0].children?.map((item) => item.kind)).toEqual(['intermediate-text', 'tool-group'])
    expect(items.at(-1)?.partIndexes).toEqual([2])
    expect(parts[0]).toEqual({ type: 'text', text: 'intermediate **markdown**' })
    expect(parts[2]).toEqual({ type: 'text', text: 'final [answer](README.md)' })
  })

  it('groups consecutive tools and stops at text or reasoning', () => {
    const items = buildAssistantRenderItems(
      message(
        tool('1', 'Read A'),
        tool('2', 'Read B'),
        { type: 'reasoning', text: 'Check result' },
        tool('3', 'Run tests'),
        { type: 'text', text: 'done' }
      ),
      false
    )

    expect(
      items[0].children?.map(({ kind, partIndexes, summary }) => ({
        kind,
        partIndexes,
        summary
      }))
    ).toEqual([
      { kind: 'tool-group', partIndexes: [0, 1], summary: 'Read A、Read B' },
      { kind: 'reasoning', partIndexes: [2], summary: 'Check result' },
      { kind: 'tool-group', partIndexes: [3], summary: 'Run tests' }
    ])
    expect(items[1]).toEqual(
      expect.objectContaining({ kind: 'final-text', partIndexes: [4], summary: 'done' })
    )
  })

  it('does not group tools across a step boundary', () => {
    const items = buildAssistantRenderItems(
      message(
        tool('1', 'Read A', 'output-available', 'read_file', 'read'),
        { type: 'step-start' },
        tool('2', 'Read B', 'output-available', 'read_file', 'read'),
        { type: 'text', text: 'done' }
      ),
      false
    )

    expect(items[0].children).toEqual([
      expect.objectContaining({ kind: 'tool-group', partIndexes: [0] }),
      expect.objectContaining({ kind: 'tool-group', partIndexes: [2] })
    ])
  })

  it('classifies a large multi-step message without merging step tools', () => {
    const parts: UIMessage['parts'] = []
    for (let index = 0; index < 1_000; index += 1) {
      parts.push({ type: 'step-start' }, tool(String(index), `Read ${index}`))
    }
    parts.push({ type: 'text', text: 'done' })

    const items = buildAssistantRenderItems(message(...parts), false)

    expect(items).toHaveLength(2)
    expect(items[0].children).toHaveLength(1_000)
    expect(items[0].children?.every((item) => item.partIndexes.length === 1)).toBe(true)
    expect(items[1]).toEqual(expect.objectContaining({ kind: 'final-text' }))
  })

  it('compresses the complete multiline text into the single-line summary', () => {
    const items = buildAssistantRenderItems(
      message(
        {
          type: 'reasoning',
          text: '用户要求：\n\n- 查看 package.json\n- 查看 src 目录\n\n然后总结项目。'
        },
        { type: 'text', text: 'done' }
      ),
      false
    )

    expect(items[0].children?.[0].summary).toBe(
      '用户要求： 查看 package.json 查看 src 目录 然后总结项目。'
    )
  })

  it('removes Markdown syntax and non-visible HTML from summaries', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'reasoning', text: '**foo_bar**  \nnext\n<!-- keep -->\n[README](README.md)' },
        { type: 'text', text: 'done' }
      ),
      false
    )

    expect(items[0].children?.[0].summary).toBe('foo_bar next README')
  })

  it('keeps only the first sentence in text and reasoning summaries', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'reasoning', text: '正在检查实现。后续推理不应累计到摘要。' },
        { type: 'text', text: 'Starting the browser checks. More progress follows.' },
        tool('1', 'Read source')
      ),
      true
    )

    expect(items[0].children?.map((item) => item.summary)).toEqual([
      '正在检查实现。',
      'Starting the browser checks.',
      'Read source'
    ])
  })

  it('segments abbreviations and unfinished summaries without a punctuation list', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'reasoning', text: 'Checking the U.S. implementation. More details follow.' },
        { type: 'text', text: '仍在检查尚未结束' },
        tool('1', 'Read source')
      ),
      true
    )

    expect(items[0].children?.map((item) => item.summary)).toEqual([
      'Checking the U.S. implementation.',
      '仍在检查尚未结束',
      'Read source'
    ])
  })

  it('does not create render items for whitespace-only text', () => {
    const streaming = {
      ...message({ type: 'text', text: '\n  \t', state: 'streaming' }),
      metadata: { startedAt: 1_000 }
    } as UIMessage
    const completed = {
      ...message({ type: 'reasoning', text: 'worked' }, { type: 'text', text: '\n  ' }),
      metadata: { startedAt: 1_000, completedAt: 2_000 }
    } as UIMessage

    expect(buildAssistantRenderItems(streaming, true).map((item) => item.kind)).toEqual(['status'])
    const completedItems = buildAssistantRenderItems(completed, false)
    expect(completedItems).toHaveLength(1)
    expect(completedItems[0]).toEqual(
      expect.objectContaining({ kind: 'activity-group', summary: '已完成 · 处理了 1秒' })
    )
  })

  it('starts a new tool group when the original tool icon changes', () => {
    const items = buildAssistantRenderItems(
      message(
        tool('1', 'Read A', 'output-available', 'read_file', 'read'),
        tool('2', 'Read B', 'output-available', 'read_file', 'read'),
        tool('3', 'Run tests', 'output-available', 'run', 'execute'),
        { type: 'text', text: 'done' }
      ),
      false
    )

    expect(items[0].children).toEqual([
      expect.objectContaining({ partIndexes: [0, 1], icon: 'read' }),
      expect.objectContaining({ partIndexes: [2], icon: 'execute' })
    ])
  })

  it('keeps pending ask user separate and open, then groups it after answering', () => {
    const pending = buildAssistantRenderItems(
      message(
        tool('1', 'Read source'),
        tool('ask', 'Choose one', 'input-available', 'agent_ask_user')
      ),
      true
    )
    expect(pending.at(-1)).toEqual(
      expect.objectContaining({ kind: 'pending-ask-user', defaultOpen: true, partIndexes: [1] })
    )

    const answered = buildAssistantRenderItems(
      message(
        tool('1', 'Read source'),
        tool('ask', 'Choose one', 'output-available', 'agent_ask_user'),
        { type: 'text', text: 'finished' }
      ),
      false
    )
    expect(answered[0].children?.[0]).toEqual(
      expect.objectContaining({
        kind: 'tool-group',
        partIndexes: [0, 1],
        summary: 'Read source、Choose one'
      })
    )
  })

  it('shows waiting instead of completed while ask user needs an answer', () => {
    const waiting = {
      ...message(
        { type: 'reasoning', text: 'I need clarification' },
        tool('ask', 'Choose one', 'input-available', 'agent_ask_user')
      ),
      metadata: { startedAt: 1_000, completedAt: 34_000 }
    } as UIMessage

    const items = buildAssistantRenderItems(waiting, false)

    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'activity-group',
        summary: '等待回答 · 处理了 33秒',
        defaultOpen: true
      })
    )
    expect(items[1]).toEqual(
      expect.objectContaining({ kind: 'pending-ask-user', defaultOpen: true })
    )
  })

  it('does not wait for a hidden raw ask-user tool part', () => {
    const hiddenAsk = {
      ...tool('ask', 'Choose one', 'input-available', 'agent_ask_user'),
      rawInput: { question: 'Choose one' }
    } as UIMessage['parts'][number]
    const completed = {
      ...message({ type: 'reasoning', text: 'done' }, hiddenAsk),
      metadata: { startedAt: 1_000, completedAt: 9_000 }
    } as UIMessage

    const items = buildAssistantRenderItems(completed, false)

    expect(items).toHaveLength(1)
    expect(items[0].summary).toBe('已完成 · 处理了 8秒')
    expect(items.some((item) => item.kind === 'pending-ask-user')).toBe(false)
  })

  it('does not treat an unanswered ask from an earlier step as currently waiting', () => {
    const completed = {
      ...message(
        { type: 'step-start' },
        tool('ask', 'Old question', 'input-available', 'agent_ask_user'),
        { type: 'step-start' },
        { type: 'reasoning', text: 'continued another way' },
        { type: 'text', text: 'final answer' }
      ),
      metadata: { startedAt: 1_000, completedAt: 9_000 }
    } as UIMessage

    const items = buildAssistantRenderItems(completed, false)

    expect(items[0].summary).toBe('已完成 · 处理了 8秒')
    expect(items.some((item) => item.kind === 'pending-ask-user')).toBe(false)
  })

  it('treats an interrupted ask-user request as terminal instead of waiting', () => {
    const aborted = {
      ...message(
        { type: 'reasoning', text: 'I need clarification' },
        tool('ask', 'Choose one', 'input-available', 'agent_ask_user')
      ),
      metadata: { startedAt: 1_000, completedAt: 9_000, outcome: 'aborted' }
    } as UIMessage

    const items = buildAssistantRenderItems(aborted, false)

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(
      expect.objectContaining({ kind: 'activity-group', summary: '已中断 · 处理了 8秒' })
    )
    expect(items[0].children?.map((item) => item.kind)).toEqual(['reasoning', 'tool-group'])
    expect(items.some((item) => item.kind === 'pending-ask-user')).toBe(false)
  })

  it('keeps streaming text inside the expanded processing area', () => {
    const items = buildAssistantRenderItems(
      message({ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'progress' }),
      true
    )
    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0]).toEqual(expect.objectContaining({ defaultOpen: true }))
    expect(items[0].children?.map((item) => item.kind)).toEqual([
      'reasoning',
      'intermediate-text'
    ])
    expect(items[0].children?.at(-1)?.defaultOpen).toBe(false)
    expect(items.slice(1).flatMap((item) => item.partIndexes)).toEqual([])
  })

  it('keeps every trailing text part visible when streaming completes', () => {
    const response = message(
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'first paragraph' },
      { type: 'text', text: 'second paragraph' }
    )

    expect(buildAssistantRenderItems(response, true).map((item) => item.kind)).toEqual([
      'activity-group'
    ])
    expect(
      buildAssistantRenderItems(response, true)[0].children?.map((item) => item.kind)
    ).toEqual(['reasoning', 'intermediate-text', 'intermediate-text'])
    expect(buildAssistantRenderItems(response, false).map((item) => item.kind)).toEqual([
      'activity-group',
      'final-text'
    ])
    expect(buildAssistantRenderItems(response, false).at(-1)?.partIndexes).toEqual([1, 2])
  })

  it('preserves whitespace-only parts between final text fragments', () => {
    const response = message(
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'first paragraph' },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: 'second paragraph' }
    )

    const final = buildAssistantRenderItems(response, false).at(-1)
    expect(final).toEqual(
      expect.objectContaining({ kind: 'final-text', partIndexes: [1, 2, 3] })
    )
    expect(
      final?.partIndexes
        .map((index) => response.parts[index])
        .map((part) => (part?.type === 'text' ? part.text : ''))
        .join('')
    ).toBe('first paragraph\n\nsecond paragraph')
  })

  it('shows elapsed processing time from the first streaming step', () => {
    const live = {
      ...message({ type: 'text', text: 'starting', state: 'streaming' }),
      metadata: { startedAt: 1_000 }
    } as UIMessage

    const items = buildAssistantRenderItems(live, true)

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0]).toEqual(expect.objectContaining({ summary: '处理了 0秒', startedAt: 1_000 }))
  })

  it('ignores invalid lifecycle timestamps', () => {
    const live = {
      ...message({ type: 'text', text: 'starting', state: 'streaming' }),
      metadata: { startedAt: Number.NaN }
    } as UIMessage
    const completed = {
      ...message({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'done' }),
      metadata: { startedAt: Number.NEGATIVE_INFINITY, completedAt: 9_000 }
    } as UIMessage

    expect(buildAssistantRenderItems(live, true).map((item) => item.kind)).toEqual([
      'activity-group'
    ])
    expect(buildAssistantRenderItems(completed, false)[0].summary).toBe('处理过程')
  })

  it('does not turn a reversed lifecycle interval into a zero-second duration', () => {
    const completed = {
      ...message({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'done' }),
      metadata: { startedAt: 9_000, completedAt: 1_000 }
    } as UIMessage
    const aborted = {
      ...message({ type: 'text', text: 'partial' }),
      metadata: { startedAt: 9_000, completedAt: 1_000, outcome: 'aborted' }
    } as UIMessage

    expect(buildAssistantRenderItems(completed, false)[0].summary).toBe('处理过程')
    const abortedItems = buildAssistantRenderItems(aborted, false)
    expect(abortedItems.map((item) => item.kind)).toEqual(['activity-group'])
    expect(abortedItems[0].summary).toBe('已中断')
  })

  it('keeps streaming reasoning collapsed while text streams directly', () => {
    const reasoning = buildAssistantRenderItems(
      message({ type: 'reasoning', text: 'thinking', state: 'streaming' }),
      true
    )
    const text = buildAssistantRenderItems(
      message({ type: 'text', text: 'answer', state: 'streaming' }),
      true
    )

    expect(reasoning[0]).toEqual(
      expect.objectContaining({ kind: 'activity-group', defaultOpen: true })
    )
    expect(reasoning[0].children?.[0]).toEqual(
      expect.objectContaining({ kind: 'reasoning', defaultOpen: false })
    )
    expect(text[0].children?.[0]).toEqual(
      expect.objectContaining({ kind: 'intermediate-text', defaultOpen: false })
    )
  })

  it('keeps streaming text and tools together in processing', () => {
    const items = buildAssistantRenderItems(
      message({ type: 'text', text: 'I will inspect it.' }, tool('1', 'Read source')),
      true
    )

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0].children?.map((item) => item.kind)).toEqual([
      'intermediate-text',
      'tool-group'
    ])
  })

  it('keeps text in processing when a hidden tool starts in the same step', () => {
    const hiddenTool = {
      ...tool('1', 'Read source'),
      state: 'input-streaming',
      input: undefined
    } as UIMessage['parts'][number]
    const items = buildAssistantRenderItems(
      message({ type: 'text', text: 'I will inspect it.' }, hiddenTool),
      true
    )

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0].children?.[0]).toEqual(
      expect.objectContaining({ kind: 'intermediate-text', partIndexes: [0] })
    )
  })

  it('does not expose text before a hidden raw tool as a final answer', () => {
    const hiddenTool = {
      ...tool('1', 'Read source'),
      rawInput: { path: 'README.md' }
    } as UIMessage['parts'][number]
    const items = buildAssistantRenderItems(
      message({ type: 'text', text: 'I will inspect it.' }, hiddenTool),
      false
    )

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0].children?.map((item) => item.kind)).toEqual(['intermediate-text'])
  })

  it('keeps every streaming step inside the processing area', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'step-start' },
        { type: 'text', text: 'I will inspect it.' },
        tool('1', 'Read source'),
        { type: 'step-start' },
        { type: 'reasoning', text: 'Reviewing the result' },
        { type: 'text', text: 'Current answer' }
      ),
      true
    )

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0]).toEqual(
      expect.objectContaining({ defaultOpen: true, partIndexes: [1, 2, 4, 5] })
    )
    expect(items[0].children?.map((item) => item.kind)).toEqual([
      'intermediate-text',
      'tool-group',
      'reasoning',
      'intermediate-text'
    ])
  })

  it('marks the expanded activity row as a live elapsed timer while streaming', () => {
    const live = {
      ...message(
        { type: 'step-start' },
        { type: 'reasoning', text: 'first step' },
        { type: 'step-start' },
        { type: 'text', text: 'current step' }
      ),
      metadata: { startedAt: 1_000 }
    } as UIMessage

    const items = buildAssistantRenderItems(live, true)

    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'activity-group',
        summary: '处理了 0秒',
        startedAt: 1_000,
        defaultOpen: true
      })
    )
  })

  it('does not lose or duplicate visible parts', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'reasoning', text: 'think' },
        tool('1', 'Read'),
        tool('2', 'Write'),
        { type: 'text', text: 'commentary' },
        { type: 'text', text: 'answer' }
      ),
      false
    )
    expect(items.flatMap((item) => item.partIndexes)).toEqual([0, 1, 2, 3, 4])
    expect(items[0].children?.flatMap((item) => item.partIndexes)).toEqual([0, 1, 2])
  })

  it('renders every visible part exactly once across structural combinations', () => {
    const candidates: UIMessage['parts'] = [
      { type: 'text', text: 'text' },
      { type: 'reasoning', text: 'reasoning' },
      tool('visible', 'Visible tool'),
      { ...tool('hidden', 'Hidden tool'), rawInput: {} } as UIMessage['parts'][number]
    ]
    const leafIndexes = (items: ReturnType<typeof buildAssistantRenderItems>): number[] =>
      items.flatMap((item) =>
        item.children ? item.children.flatMap((child) => child.partIndexes) : item.partIndexes
      )

    for (let first = 0; first < candidates.length; first += 1) {
      for (let second = 0; second < candidates.length; second += 1) {
        const parts = [candidates[first], candidates[second]]
        const expected = parts.flatMap((part, index) => {
          if (part.type === 'text' || part.type === 'reasoning') return [index]
          return isToolUIPart(part) && isVisibleToolPart(part) ? [index] : []
        })

        for (const streaming of [false, true]) {
          expect(
            leafIndexes(buildAssistantRenderItems(message(...parts), streaming)).toSorted(
              (left, right) => left - right
            )
          ).toEqual(expected)
        }
      }
    }
  })

  it('collapses all completed activity into one outer row', () => {
    const items = buildAssistantRenderItems(
      message(
        { type: 'reasoning', text: 'think' },
        tool('1', 'Read'),
        { type: 'text', text: 'progress' },
        tool('2', 'Write'),
        { type: 'text', text: 'answer' }
      ),
      false
    )

    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(
      expect.objectContaining({ kind: 'activity-group', defaultOpen: false })
    )
    expect(items[0].children).toHaveLength(4)
    expect(items[1].kind).toBe('final-text')
  })

  it('shows the completed processing duration on the outer row', () => {
    const items = buildAssistantRenderItems(
      timedMessage({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' }),
      false
    )

    expect(items[0].summary).toBe('已完成 · 处理了 5分钟 28秒')
  })

  it('counts only fully elapsed seconds in a completed duration', () => {
    const items = buildAssistantRenderItems(
      {
        ...message({ type: 'text', text: 'answer' }),
        metadata: { startedAt: 1_000, completedAt: 1_999 }
      } as UIMessage,
      false
    )

    expect(items[0].summary).toBe('已完成 · 处理了 0秒')
  })

  it('does not claim completion for legacy messages without timing metadata', () => {
    const items = buildAssistantRenderItems(
      message({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' }),
      false
    )

    expect(items[0].summary).toBe('处理过程')
  })

  it('shows an aborted processing duration on the outer row', () => {
    const aborted = {
      ...timedMessage({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'partial' }),
      metadata: { startedAt: 1_000, completedAt: 9_000, outcome: 'aborted' }
    } as UIMessage

    const items = buildAssistantRenderItems(aborted, false)

    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'activity-group',
        summary: '已中断 · 处理了 8秒',
        defaultOpen: false
      })
    )
  })

  it('expands only active and waiting activity groups', () => {
    const parts: UIMessage['parts'] = [
      { type: 'reasoning', text: 'working' },
      tool('ask', 'Choose one', 'input-available', 'agent_ask_user')
    ]
    const streaming = buildAssistantRenderItems(message(...parts), true)
    const waiting = buildAssistantRenderItems(message(...parts), false)
    const completed = buildAssistantRenderItems(
      timedMessage({ type: 'reasoning', text: 'worked' }, { type: 'text', text: 'done' }),
      false
    )
    const interrupted = buildAssistantRenderItems(
      {
        ...timedMessage({ type: 'reasoning', text: 'worked' }),
        metadata: { startedAt: 1_000, completedAt: 2_000, outcome: 'aborted' }
      } as UIMessage,
      false
    )

    expect(streaming[0].defaultOpen).toBe(true)
    expect(waiting[0].defaultOpen).toBe(true)
    expect(completed[0].defaultOpen).toBe(false)
    expect(interrupted[0].defaultOpen).toBe(false)
  })

  it('shows aborted elapsed time even when the response only contains text', () => {
    const aborted = {
      ...message({ type: 'text', text: 'partial answer' }),
      metadata: { startedAt: 1_000, completedAt: 9_000, outcome: 'aborted' }
    } as UIMessage

    const items = buildAssistantRenderItems(aborted, false)

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0].summary).toBe('已中断 · 处理了 8秒')
    expect(items[0].children?.map((item) => item.kind)).toEqual(['intermediate-text'])
  })

  it('shows a stream error as interrupted with elapsed time', () => {
    const failed = {
      ...timedMessage({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'partial' }),
      metadata: { startedAt: 1_000, completedAt: 9_000, outcome: 'error' }
    } as UIMessage

    const items = buildAssistantRenderItems(failed, false)

    expect(items[0].summary).toBe('已中断 · 处理了 8秒')
  })

  it('shows a legacy stream error as interrupted without timing metadata', () => {
    const failed = {
      ...message({ type: 'reasoning', text: 'think' }, { type: 'text', text: 'partial' }),
      metadata: { outcome: 'error' }
    } as UIMessage

    expect(buildAssistantRenderItems(failed, false)[0].summary).toBe('已中断')
  })

  it('shows a legacy text-only interruption without timing metadata', () => {
    const failed = {
      ...message({ type: 'text', text: 'partial' }),
      metadata: { outcome: 'aborted' }
    } as UIMessage

    const items = buildAssistantRenderItems(failed, false)

    expect(items.map((item) => item.kind)).toEqual(['activity-group'])
    expect(items[0].summary).toBe('已中断')
  })
})
