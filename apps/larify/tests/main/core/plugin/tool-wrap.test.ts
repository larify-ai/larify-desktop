import { describe, expect, it, vi } from 'vitest'
import { jsonSchema } from 'ai'
import { z } from 'zod'
import type { Tool } from '../../../../src/main/core/plugin/protocol'
import { wrapTool } from '../../../../src/main/core/plugin/protocol'

// 模拟 @ai-sdk/mcp 产出的工具 inputSchema 形状：jsonSchema() 返回 { _type, jsonSchema, validate }
function mcpTool(properties: Record<string, unknown>, required: string[] = []): Tool {
  const schema = jsonSchema({ type: 'object', properties, required })
  return {
    description: 'mcp tool',
    inputSchema: schema as unknown as Tool['inputSchema'],
    execute: vi.fn(async (args: unknown) => ({ ok: true, args }))
  }
}

describe('wrapTool', () => {
  it('keeps the Zod path working (regression)', () => {
    const tool: Tool = {
      description: 'zod tool',
      inputSchema: z.object({ q: z.string() }) as unknown as Tool['inputSchema'],
      execute: vi.fn(async () => 'done')
    }
    const wrapped = wrapTool(tool)
    expect(wrapped.execute).toBeTypeOf('function')
    expect((wrapped.inputSchema as unknown as z.ZodTypeAny) instanceof z.ZodObject).toBe(true)
  })

  it('converts a JSON-schema (MCP) tool to Zod and injects toolCallTitle', () => {
    const tool = mcpTool({ q: { type: 'string' } }, ['q'])
    const wrapped = wrapTool(tool)
    const schema = wrapped.inputSchema as unknown as z.ZodObject
    expect(schema instanceof z.ZodObject).toBe(true)
    expect('toolCallTitle' in schema.shape).toBe(true)
  })

  it('strips toolCallTitle before calling the underlying execute', async () => {
    const tool = mcpTool({ q: { type: 'string' } }, ['q'])
    const wrapped = wrapTool(tool)
    const opts = {} as Parameters<NonNullable<Tool['execute']>>[1]
    await wrapped.execute?.({ q: 'x', toolCallTitle: 'Step 1' }, opts)
    expect(tool.execute).toHaveBeenCalledWith({ q: 'x' }, opts)
  })

  it('does not mutate the original JSON schema object', () => {
    const tool = mcpTool({ q: { type: 'string' } }, ['q'])
    const before = JSON.stringify((tool.inputSchema as { jsonSchema: unknown }).jsonSchema)
    wrapTool(tool)
    const after = JSON.stringify((tool.inputSchema as { jsonSchema: unknown }).jsonSchema)
    expect(before).toBe(after)
  })

  it('rejects a tool whose schema is neither Zod nor JSON object schema', () => {
    const tool: Tool = {
      description: 'bad',
      inputSchema: { some: 'weird', object: 1 } as unknown as Tool['inputSchema'],
      execute: () => undefined
    }
    expect(() => wrapTool(tool)).toThrow(/JSON object schema/)
  })

  it('throws when JSON-schema tool already defines the reserved toolCallTitle field', () => {
    const tool = mcpTool({ q: { type: 'string' }, toolCallTitle: { type: 'string' } }, ['q'])
    expect(() => wrapTool(tool)).toThrow(/reserved "toolCallTitle"/)
  })

  it('handles a JSON-schema tool without any properties', () => {
    const tool = mcpTool({}, [])
    const wrapped = wrapTool(tool)
    const schema = wrapped.inputSchema as unknown as z.ZodObject
    expect('toolCallTitle' in schema.shape).toBe(true)
  })
})
