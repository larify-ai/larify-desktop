import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), createModelRuntime: vi.fn() }))

vi.mock('ai', () => ({ generateText: mocks.generateText }))
vi.mock('../../../../src/main/core/model', () => ({
  createModelRuntime: mocks.createModelRuntime
}))

import { generateSessionTitle } from '../../../../src/main/core/session/title'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createModelRuntime.mockReturnValue({ model: 'title-model', providerOptions: {} })
  mocks.generateText.mockResolvedValue({ text: '  Generated title  ' })
})

it('uses the flash model and returns trimmed title text', async () => {
  await expect(generateSessionTitle('Explain the issue')).resolves.toBe('Generated title')

  expect(mocks.createModelRuntime).toHaveBeenCalledWith({
    modelId: 'deepseek-v4-flash',
    reasoningEffort: 'off'
  })
  expect(mocks.generateText).toHaveBeenCalledWith({
    model: 'title-model',
    providerOptions: {},
    prompt:
      '用户消息：Explain the issue\n\n不要回答用户消息, 只根据用户消息生成一个简短的会话标题\n只输出纯文字标题, 不要包括标点符号, 不要超过5个字',
    maxOutputTokens: 20
  })
})

it('forwards the own api key to the runtime so the title path uses the official provider', async () => {
  await generateSessionTitle('Explain the issue', {
    modelId: 'deepseek-v4-pro',
    reasoningEffort: 'off',
    apiKey: 'sk-own'
  })

  expect(mocks.createModelRuntime).toHaveBeenCalledWith({
    modelId: 'deepseek-v4-flash',
    reasoningEffort: 'off',
    apiKey: 'sk-own'
  })
})

it('does not forward an empty api key', async () => {
  await generateSessionTitle('Explain the issue', {
    modelId: 'deepseek-v4-pro',
    reasoningEffort: 'off'
  })

  expect(mocks.createModelRuntime).toHaveBeenCalledWith({
    modelId: 'deepseek-v4-flash',
    reasoningEffort: 'off'
  })
})
