import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

import { MessageView } from '../../../src/renderer/src/app/interaction/assistant/message-view'

describe('interaction assistant message view', () => {
  it('renders supported parts in their original order', () => {
    const markup = render(
      message([
        { type: 'text', text: 'before' },
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { toolCallTitle: 'Read file', path: 'a.txt' },
          output: 'done'
        },
        { type: 'text', text: 'after' }
      ])
    )

    expect(markup.indexOf('before')).toBeLessThan(markup.indexOf('Read file'))
    expect(markup.indexOf('Read file')).toBeLessThan(markup.indexOf('after'))
  })

  it('uses the tool name when no display title is provided', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { path: 'a.txt' }
        }
      ])
    )

    expect(markup).toContain('fs_read')
  })

  it('renders an ask-user communication card', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {
            message: 'Choose a mode',
            options: [
              { label: 'Fast', description: 'Finish sooner' },
              { label: 'Safe', description: 'Check more carefully' }
            ]
          }
        }
      ])
    )

    expect(markup).toContain('Choose a mode')
    expect(markup).toContain('Fast')
    expect(markup).toContain('Finish sooner')
    expect(markup).toContain('提交')
    expect(markup).toContain('agent_ask_user')
  })

  it('collapses a submitted ask-user card', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {
            message: 'Choose a mode',
            options: [{ label: 'Safe' }]
          },
          output: { answers: ['Safe'] }
        }
      ])
    )

    expect(markup).not.toContain('Choose a mode')
    expect(markup).not.toContain('已回答')
    expect(markup).toContain('agent_ask_user')
  })

  it('filters model-provided custom options because free text is always available', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {
            message: 'Choose a mode',
            options: [
              { label: 'Safe' },
              { label: '其它', description: 'Describe another approach' }
            ]
          }
        }
      ])
    )

    expect(markup).not.toContain('其它')
    expect(markup).toContain('其他或补充说明（可选）')
  })

  it('hides an ask-user card until its streamed display title arrives', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-streaming',
          input: {}
        }
      ])
    )

    expect(markup).not.toContain('agent_ask_user')
    expect(markup).not.toContain('等待回答')
  })

  it('does not create a message container for invalid tool input', () => {
    expect(
      render(
        message([
          {
            type: 'tool-fs_grep',
            toolCallId: 'call-1',
            state: 'output-error',
            input: undefined,
            rawInput: { pattern: 'value' },
            errorText: 'Invalid input'
          }
        ])
      )
    ).toBe('')
  })

  it('creates a message container for validated live tool input', () => {
    const markup = render(
      message([
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { toolCallTitle: 'Read file', path: 'a.txt' },
          rawInput: undefined,
          output: 'done'
        }
      ])
    )

    expect(markup).toContain('Read file')
  })

  it('keeps user attachments aligned with user content', () => {
    const markup = render(
      message(
        [
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'notes.txt',
            url: 'file:///notes.txt'
          }
        ],
        'user'
      )
    )

    expect(markup).toContain('notes.txt')
    expect(markup).toContain('group-[.is-user]:ml-auto')
    expect(markup).not.toContain('select-text')
  })

  it('renders pasted images without a fallback filename', () => {
    const markup = render(
      message(
        [
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,aW1hZ2U='
          }
        ],
        'user'
      )
    )

    expect(markup).toContain('<img')
    expect(markup).not.toContain('>图片<')
  })

  it('does not create an empty message container for unsupported parts', () => {
    expect(render(message([{ type: 'step-start' }]))).toBe('')
  })

  it('renders markdown code blocks and tables', () => {
    const markup = render(
      message([
        {
          type: 'text',
          text: '```ts\nconst value = 1\n```\n\n| Name | Value |\n| --- | --- |\n| A | 1 |'
        }
      ])
    )

    expect(markup).toContain('data-streamdown="code-block"')
    expect(markup).toContain('<table')
    expect(markup).toContain('const value')
  })

  it('does not render empty text or reasoning parts', () => {
    expect(
      render(
        message([
          { type: 'text', text: '' },
          { type: 'reasoning', text: '', state: 'done' }
        ])
      )
    ).toBe('')
  })

  it('does not render whitespace-only text or reasoning parts', () => {
    expect(
      render(
        message([
          { type: 'text', text: '\n  ' },
          { type: 'reasoning', text: '\t', state: 'done' }
        ])
      )
    ).toBe('')
  })

  it('renders a single change card for a snapshot-only assistant message', () => {
    const markup = render(
      message([snapshot([{ additions: 2, deletions: 1, path: 'src/file.ts', patch: 'patch' }])])
    )

    expect(markup).toContain('已编辑 1 个文件')
    expect(markup).toContain('src/file.ts')
    expect(markup).toContain('+2')
    expect(markup).toContain('−1')
  })

  it('renders only the latest snapshot while a message is updated', () => {
    const markup = render(
      message([
        snapshot([{ additions: 1, deletions: 0, path: 'old.ts', patch: 'old' }]),
        { type: 'text', text: 'done' },
        snapshot([{ additions: 3, deletions: 2, path: 'latest.ts', patch: 'latest' }])
      ])
    )

    expect(markup).toContain('latest.ts')
    expect(markup).not.toContain('old.ts')
    expect(markup.match(/<section aria-label="已编辑 1 个文件"/g)).toHaveLength(1)
  })

  it('does not render an assistant change card in a user message', () => {
    expect(
      render(
        message(
          [snapshot([{ additions: 1, deletions: 0, path: 'user.ts', patch: 'patch' }])],
          'user'
        )
      )
    ).toBe('')
  })

  it('renders attachments only in the first message fragment', () => {
    const value = message(
      [
        { type: 'file', mediaType: 'text/plain', filename: 'notes.txt', url: 'file:///notes.txt' },
        { type: 'text', text: 'content' }
      ],
      'user'
    )

    const renderItem = item('final-text', [1])
    expect(render(value, { renderItem, firstFragment: true })).toContain('notes.txt')
    expect(render(value, { renderItem, firstFragment: false })).not.toContain('notes.txt')
  })

  it('renders the change summary only in the last message fragment', () => {
    const value = message([
      { type: 'text', text: 'content' },
      snapshot([{ additions: 2, deletions: 1, path: 'src/file.ts', patch: 'patch' }])
    ])

    const renderItem = item('final-text', [0])
    expect(render(value, { renderItem, lastFragment: false })).not.toContain('src/file.ts')
    expect(render(value, { renderItem, lastFragment: true })).toContain('src/file.ts')
    expect(render(value, { renderItem, lastFragment: true, hideChanges: true })).not.toContain(
      'src/file.ts'
    )
  })

  it('renders only the selected original part', () => {
    const value = message([
      { type: 'text', text: 'FIRST_CONTENT' },
      { type: 'step-start' },
      { type: 'text', text: 'LAST_CONTENT' }
    ])
    const markup = render(value, { renderItem: item('final-text', [2]) })

    expect(markup).toContain('LAST_CONTENT')
    expect(markup).not.toContain('FIRST_CONTENT')
  })

  it('renders the last non-empty text part without concatenating earlier fragments', () => {
    const value = message([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'first paragraph' },
      { type: 'text', text: 'second paragraph' }
    ])
    const markup = render(value, { renderItem: item('final-text', [1, 2]) })

    expect(markup).toContain('second paragraph')
    expect(markup).not.toContain('first paragraph')
  })
})

function render(value: UIMessage, props: Omit<ComponentProps<typeof MessageView>, 'message'> = {}): string {
  return renderToStaticMarkup(createElement(MessageView, { message: value, ...props }))
}

function message(parts: unknown[], role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id: 'message-1', role, parts } as UIMessage
}

function item(kind: 'final-text', partIndexes: number[]) {
  return { kind, partIndexes, summary: '' } as const
}

function snapshot(
  files: Array<{ additions: number; deletions: number; patch: string; path: string }>
): { data: unknown; type: string } {
  return { data: { files }, type: 'data-git-snapshot' }
}
