import { describe, expect, it } from 'vitest'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { promoteToolImages } from '../../../../src/main/core/agent/tool-images'

describe('promoteToolImages', () => {
  it('moves image files from tool output into a following user message', () => {
    const image = {
      type: 'file' as const,
      mediaType: 'image/png',
      filename: 'screen.png',
      data: { type: 'data' as const, data: new Uint8Array([1, 2, 3]) }
    }
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'fs_read_image',
            input: { file_path: 'screen.png' },
            output: {
              type: 'content',
              value: [{ type: 'text', text: 'image metadata' }, image]
            }
          }
        ]
      }
    ]

    expect(promoteToolImages(prompt, true)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'fs_read_image',
            input: { file_path: 'screen.png' },
            output: { type: 'text', value: 'Image loaded.' }
          }
        ]
      },
      {
        role: 'user',
        content: [image]
      }
    ])
  })

  it('leaves text-only tool output unchanged', () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'fs_read',
            input: { file_path: 'notes.txt' },
            output: { type: 'text', value: 'hello' }
          }
        ]
      }
    ]

    expect(promoteToolImages(prompt, true)).toEqual(prompt)
  })

  it('leaves image output from other tools unchanged', () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'browser_screenshot',
            input: {},
            output: {
              type: 'content',
              value: [
                {
                  type: 'file',
                  mediaType: 'image/png',
                  data: { type: 'data', data: new Uint8Array([1, 2, 3]) }
                }
              ]
            }
          }
        ]
      }
    ]

    expect(promoteToolImages(prompt, true)).toEqual(prompt)
  })

  it('removes historical images for a non-vision model', () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'fs_read_image',
            input: { file_path: 'screen.png' },
            output: {
              type: 'content',
              value: [
                {
                  type: 'file',
                  mediaType: 'image/png',
                  data: { type: 'data', data: new Uint8Array([1, 2, 3]) }
                }
              ]
            }
          }
        ]
      }
    ]

    expect(promoteToolImages(prompt, false)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'fs_read_image',
            input: { file_path: 'screen.png' },
            output: { type: 'text', value: 'Image loaded.' }
          }
        ]
      }
    ])
  })
})
