import { createElement } from 'react'
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

  it('uses a stable waiting label while ask-user input is streaming', () => {
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

    expect(markup).toContain('等待回答')
    expect(markup).not.toContain('等待中')
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
})

function render(value: UIMessage): string {
  return renderToStaticMarkup(createElement(MessageView, { message: value }))
}

function message(parts: unknown[], role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id: 'message-1', role, parts } as UIMessage
}
