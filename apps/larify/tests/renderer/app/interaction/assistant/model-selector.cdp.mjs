/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (expression, label, timeout = 5_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const trigger = '[aria-label="配置模型和思考强度"]'
const menu = '[data-slot="dropdown-menu-content"]'

try {
  const initial = await waitFor(
    `(() => {
    const buttons = Array.from(document.querySelectorAll(${JSON.stringify(trigger)}))
    const model = buttons.find((button) => button.getBoundingClientRect().width > 0)
    const submit = model?.closest('form')?.querySelector('button[type="submit"]')
    if (!model || !submit) return null
    const modelRect = model.getBoundingClientRect()
    const submitRect = submit.getBoundingClientRect()
    return {
      modelText: model.textContent?.trim(),
      modelTitle: model.getAttribute('title'),
      modelRight: modelRect.right,
      submitLeft: submitRect.left,
      storage: localStorage.getItem('larify.modelConfig')
    }
  })()`,
    'visible model selector'
  )
  if (initial.modelRight > initial.submitLeft) {
    throw new Error(`Model selector is not left of submit: ${JSON.stringify(initial)}`)
  }
  if (initial.modelTitle !== null) throw new Error(`Unexpected model title: ${initial.modelTitle}`)

  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).find(
      (candidate) => candidate.getBoundingClientRect().width > 0
    )
    button?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
  })()`)
  const opened = await waitFor(
    `(() => {
    const content = document.querySelector(${JSON.stringify(menu)})
    if (!content) return null
    const effort = Array.from(content.querySelectorAll('button')).map((button) => ({
      label: button.textContent?.trim(),
      pressed: button.getAttribute('aria-pressed')
    }))
    const models = Array.from(content.querySelectorAll('[role="menuitem"]')).map((item) =>
      item.textContent?.trim()
    )
    return {
      effort,
      firstRow: content.firstElementChild?.textContent?.replace(/\\s+/g, ''),
      models,
      side: content.getAttribute('data-side'),
      triggerBoxShadow: getComputedStyle(document.querySelector(${JSON.stringify(trigger)}))
        .boxShadow
    }
  })()`,
    'model menu'
  )
  if (
    opened.firstRow !== '思考强度低中高' ||
    opened.effort.map(({ label }) => label).join(',') !== '低,中,高' ||
    opened.models.length !== 3 ||
    opened.side !== 'top' ||
    opened.triggerBoxShadow !== 'none'
  ) {
    throw new Error(`Unexpected model menu: ${JSON.stringify(opened)}`)
  }

  const initialEffort = opened.effort.find(({ pressed }) => pressed === 'true')?.label
  const nextEffort = initialEffort === '高' ? '中' : '高'
  await evaluate(`(() => {
    const content = document.querySelector(${JSON.stringify(menu)})
    Array.from(content?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === ${JSON.stringify(nextEffort)}
    )?.click()
  })()`)
  await waitFor(
    `document.querySelector(${JSON.stringify(menu)}) && JSON.parse(localStorage.getItem('larify.modelConfig')).reasoningEffort === ${JSON.stringify(nextEffort === '高' ? 'max' : 'high')}`,
    'reasoning effort selection'
  )
  await evaluate(`(() => {
    const content = document.querySelector(${JSON.stringify(menu)})
    Array.from(content?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === ${JSON.stringify(initialEffort)}
    )?.click()
  })()`)
  await waitFor(
    `JSON.parse(localStorage.getItem('larify.modelConfig')).reasoningEffort === ${JSON.stringify(initialEffort === '高' ? 'max' : initialEffort === '中' ? 'high' : 'off')}`,
    'reasoning effort restoration'
  )

  // 从三个候选模型里，取一个不同于当前显示模型的"下一个"模型（用于往返切换验证）
  const modelCandidates = ['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash', 'DeepSeek-V4-Flash-Vision']
  const initialModel = modelCandidates.find((m) => initial.modelText?.includes(m)) ?? 'DeepSeek-V4-Flash'
  const nextModel = modelCandidates.find((m) => m !== initialModel) ?? 'DeepSeek-V4-Pro'
  await evaluate(`(() => {
    const content = document.querySelector(${JSON.stringify(menu)})
    Array.from(content?.querySelectorAll('[role="menuitem"]') ?? []).find(
      (item) => item.textContent?.trim() === ${JSON.stringify(nextModel)}
    )?.click()
  })()`)
  await waitFor(
    `Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).some((button) => button.getBoundingClientRect().width > 0 && button.textContent.includes(${JSON.stringify(nextModel)}))`,
    'model selection'
  )
  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).find(
      (candidate) => candidate.getBoundingClientRect().width > 0
    )
    button?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
  })()`)
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(menu)}))`, 'restored model menu')
  await evaluate(`(() => {
    const content = document.querySelector(${JSON.stringify(menu)})
    Array.from(content?.querySelectorAll('[role="menuitem"]') ?? []).find(
      (item) => item.textContent?.trim() === ${JSON.stringify(initialModel)}
    )?.click()
  })()`)
  await waitFor(
    `Array.from(document.querySelectorAll(${JSON.stringify(trigger)})).some((button) => button.getBoundingClientRect().width > 0 && button.textContent.includes(${JSON.stringify(initialModel)}))`,
    'model restoration'
  )

  console.log(JSON.stringify({ initial, opened }, null, 2))
} finally {
  cdp.close()
}
