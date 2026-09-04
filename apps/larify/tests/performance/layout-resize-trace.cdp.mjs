/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'

const output = process.env.LARIFY_TRACE_OUTPUT
if (!output) throw new Error('LARIFY_TRACE_OUTPUT is required')
const diagnosticStyle = process.env.LARIFY_TRACE_STYLE
const action = process.env.LARIFY_TRACE_ACTION ?? 'resize'
const defaultFrameSampleLimit =
  action === 'stress-suite'
    ? 2_400
    : action === 'scroll-long' || action === 'scroll-programmatic'
      ? 900
      : 600
const frameSampleLimit = Number(
  process.env.LARIFY_TRACE_FRAME_SAMPLE_LIMIT ?? defaultFrameSampleLimit
)
const threadTitle = process.env.LARIFY_TRACE_THREAD
const stressSessionId = process.env.LARIFY_TRACE_STRESS_SESSION_ID
const workbenchTab = process.env.LARIFY_TRACE_WORKBENCH_TAB
const workbenchRenderer = process.env.LARIFY_TRACE_WORKBENCH_RENDERER
const workbenchTabCount = Number(process.env.LARIFY_TRACE_WORKBENCH_TAB_COUNT ?? 1)
const workbenchCwd = process.env.LARIFY_TRACE_WORKBENCH_CWD
const includeFeatureTabs = process.env.LARIFY_TRACE_WORKBENCH_FEATURE_TABS === '1'
const cleanupStressOnly = process.env.LARIFY_TRACE_CLEANUP_STRESS_ONLY === '1'
const syntheticMessageCount = Number(process.env.LARIFY_TRACE_SYNTHETIC_MESSAGE_COUNT ?? 0)
const resizeSteps = Number(process.env.LARIFY_TRACE_RESIZE_STEPS ?? 180)
const programmaticScrollMaxFrames = Number(
  process.env.LARIFY_TRACE_PROGRAMMATIC_MAX_FRAMES ?? 600
)
const programmaticTopSettleFrames = Number(
  process.env.LARIFY_TRACE_PROGRAMMATIC_TOP_SETTLE_FRAMES ?? 60
)
const evaluationTimeout = Number(process.env.LARIFY_TRACE_EVALUATION_TIMEOUT ?? 60_000)
const resizeTarget = process.env.LARIFY_TRACE_RESIZE_TARGET ?? 'workbench'
const tracingEnabled = process.env.LARIFY_TRACE_DISABLED !== '1'
const freezeBrowserSize = process.env.LARIFY_TRACE_FREEZE_BROWSER_SIZE === '1'
const freezeBrowserBounds = process.env.LARIFY_TRACE_FREEZE_BROWSER_BOUNDS === '1'
const skipBrowserBounds = process.env.LARIFY_TRACE_SKIP_BROWSER_BOUNDS === '1'
const skipNativeLayout = process.env.LARIFY_TRACE_SKIP_NATIVE_LAYOUT === '1'
const browserBoundsMode = process.env.LARIFY_TRACE_BROWSER_BOUNDS_MODE ?? 'full'
const reloadPage = process.env.LARIFY_TRACE_RELOAD === '1'
const cpuProfileEnabled = process.env.LARIFY_TRACE_CPU_PROFILE === '1'
const disablePerformanceMeasure = process.env.LARIFY_TRACE_DISABLE_PERFORMANCE_MEASURE === '1'
const disableStreamdownAstCache = process.env.LARIFY_TRACE_DISABLE_STREAMDOWN_AST_CACHE === '1'
const expandProcessed = process.env.LARIFY_TRACE_EXPAND_PROCESSED === '1'
const hideNativeBrowser = process.env.LARIFY_TRACE_HIDE_NATIVE_BROWSER === '1'
const browserTestUrl = process.env.LARIFY_TRACE_BROWSER_URL ?? 'https://www.xiaohongshu.com/explore'
const browserTestUrls = process.env.LARIFY_TRACE_BROWSER_URLS
  ? JSON.parse(process.env.LARIFY_TRACE_BROWSER_URLS)
  : [browserTestUrl]
const expectedBrowserUrl = new URL(browserTestUrl)
const expectedBrowserPrefix = `${expectedBrowserUrl.origin}${expectedBrowserUrl.pathname}`
let createdBrowserResource = null
let extraBrowserResources = []
let extraWorkbenchResources = []
let syntheticScriptIdentifier = null
let hiddenBrowserResource = null
let stressBrowserTargets = []

const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const target = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
if (!target?.webSocketDebuggerUrl) throw new Error('Larify CDP target not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

let id = 0
const pending = new Map()
const traceEvents = []
let tracingComplete
const tracingDone = new Promise((resolve) => {
  tracingComplete = resolve
})

socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  if (message.method === 'Tracing.dataCollected') traceEvents.push(...message.params.value)
  if (message.method === 'Tracing.tracingComplete') tracingComplete()
  const command = pending.get(message.id)
  if (!command) return
  pending.delete(message.id)
  clearTimeout(command.timer)
  if (message.error) command.reject(new Error(message.error.message))
  else command.resolve(message.result)
})

function send(method, params = {}, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const commandId = ++id
    const timer = setTimeout(() => {
      pending.delete(commandId)
      reject(new Error(`${method} timed out`))
    }, timeout)
    pending.set(commandId, { reject, resolve, timer })
    socket.send(JSON.stringify({ id: commandId, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    evaluationTimeout
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function evaluateRemoteTarget(webSocketDebuggerUrl, expression) {
  const targetSocket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    targetSocket.once('open', resolve)
    targetSocket.once('error', reject)
  })
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('remote target inspection timed out')), 5_000)
      const onMessage = (raw) => {
        const message = JSON.parse(String(raw))
        if (message.id !== 1) return
        clearTimeout(timer)
        targetSocket.off('message', onMessage)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result?.result?.value)
      }
      targetSocket.on('message', onMessage)
      targetSocket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true
          }
        })
      )
    })
    return result
  } finally {
    targetSocket.close()
  }
}

await send('Page.bringToFront')
if (stressSessionId) {
  await evaluate(`(async () => {
    const resources = await window.bridge.invoke('resource:list', {
      sessionId: ${JSON.stringify(stressSessionId)}
    })
    if (resources.length > 0) {
      await window.bridge.invoke('resource:close-many', resources.map(({ id }) => id))
    }
    return resources.length
  })()`)
}
const baselineExternalTargetIds = new Set(
  (await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json()))
    .filter(({ type, url }) => (type === 'page' || type === 'webview') && !url.startsWith('http://localhost:'))
    .map(({ id }) => id)
)
const staleStressResourceCount = await evaluate(`(async () => {
  const resources = await window.bridge.invoke('resource:list', { type: 'browser' })
  const stale = []
  for (const resource of resources) {
    const state = await window.bridge.invoke('browser:getState', resource.sessionId, resource.id)
    if (state?.url?.includes('larify_perf_tab=')) stale.push(resource.id)
  }
  if (stale.length > 0) await window.bridge.invoke('resource:close-many', stale)
  return stale.length
})()`)
if (cleanupStressOnly) {
  await evaluate(`new Promise((resolve) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === '新建任务'
    )
    button?.click()
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })`)
  const pageDiagnostics = await evaluate(`({
    title: document.title,
    bodyText: document.body?.innerText?.slice(0, 500),
    workbenchSessions: Array.from(document.querySelectorAll('[data-workbench-session]')).map(
      (element) => ({
        active: element.getAttribute('data-active'),
        id: element.getAttribute('data-workbench-session')
      })
    ),
    buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
      label: button.getAttribute('aria-label'),
      text: button.textContent?.trim().slice(0, 80)
    })).filter(({ label }) => label)
  })`)
  await writeFile(
    output,
    JSON.stringify({ traceEvents: [], metadata: { staleStressResourceCount, pageDiagnostics } })
  )
  socket.close()
  process.exit(0)
}
if (syntheticMessageCount > 0) {
  const syntheticScript = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const count = ${syntheticMessageCount}
      const originalInvoke = window.bridge.invoke.bind(window.bridge)
      const message = (index) => ({
        id: 'larify-perf-' + index,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [{
          type: 'text',
          text: index % 2 === 0
            ? '性能测试消息 ' + index + '：请分析这一段较长的对话内容。'.repeat(6)
            : '性能测试回复 ' + index + '\\n\\n' + '- 列表内容与 **Markdown** 文本。\\n'.repeat(12)
        }]
      })
      window.bridge.invoke = (channel, ...args) => {
        if (channel === 'session:msg-count') return Promise.resolve(count)
        if (channel === 'session:msgs') {
          const offset = Number(args[1] ?? 0)
          const limit = Number(args[2] ?? count)
          return Promise.resolve(Array.from({ length: Math.max(0, Math.min(limit, count - offset)) },
            (_, index) => message(offset + index)))
        }
        if (channel === 'attachment:load' && Array.isArray(args[0]) &&
            args[0].some((item) => String(item?.id ?? '').startsWith('larify-perf-'))) {
          return Promise.resolve(args[0])
        }
        return originalInvoke(channel, ...args)
      }
    })()`
  })
  syntheticScriptIdentifier = syntheticScript.identifier
}
if (reloadPage || syntheticMessageCount > 0) {
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolve) => setTimeout(resolve, 3_000))
}
if (threadTitle) {
  await evaluate(`new Promise((resolve) => {
    const title = ${JSON.stringify(threadTitle)}
    if (document.querySelector('header')?.textContent?.includes(title)) {
      resolve()
      return
    }
    let attempts = 0
    const find = () => Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === title
    )
    const open = () => {
      attempts += 1
      const button = find()
      if (button) {
        button.click()
        setTimeout(resolve, 1500)
        return
      }
      if (attempts >= 20) {
        throw new Error('performance thread not found: ' + title)
      }
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === '更多'
      )?.click()
      setTimeout(open, 500)
    }
    open()
  })`)
}
if (expandProcessed) {
  await evaluate(`new Promise((resolve) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) =>
        /^(?:处理了|已完成|已中断|等待回答)/.test(candidate.textContent?.trim() ?? '') &&
        candidate.getAttribute('aria-expanded') === 'false'
    )
    button?.click()
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })`)
}
if (action === 'stress-suite') {
  const longHistoryVisible = await evaluate(`new Promise((resolve) => {
    let attempts = 0
    const waitForHistory = () => {
      const log = Array.from(document.querySelectorAll('[role="log"]')).sort(
        (left, right) => right.scrollHeight - left.scrollHeight
      )[0]
      if (document.querySelectorAll('[data-message-index]').length > 0 && log?.scrollHeight > 10_000) {
        resolve(true)
        return
      }
      attempts += 1
      if (attempts >= 600) {
        resolve(false)
        return
      }
      setTimeout(waitForHistory, 50)
    }
    waitForHistory()
  })`)
  if (!longHistoryVisible) throw new Error('synthetic 2000-message history did not become visible')
}
if (hideNativeBrowser) {
  hiddenBrowserResource = await evaluate(`(async () => {
    const host = document.querySelector('[data-workbench-session][data-active="true"]')
    const sessionId = host?.getAttribute('data-workbench-session')
    if (!sessionId) return null
    const views = Array.from(document.querySelectorAll('[data-workbench-view="browser"]'))
    const resources = views.map((view) => Number(view.getAttribute('data-resource-id')))
    const active = views.find((view) => view.getAttribute('data-active') === 'true')
    const activeResourceId = active ? Number(active.getAttribute('data-resource-id')) : null
    await Promise.all(
      resources.map((resourceId) =>
        window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)
      )
    )
    return { sessionId, resourceIds: resources, activeResourceId }
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 250))
}
if (workbenchTab || workbenchRenderer) {
  await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
  await evaluate(`new Promise((resolve, reject) => {
    let attempts = 0
    const wait = () => {
      if (document.querySelector('[data-workbench-session][data-active="true"]')) {
        resolve()
        return
      }
      attempts += 1
      if (attempts >= 600) {
        reject(new Error('active workbench session did not mount'))
        return
      }
      setTimeout(wait, 50)
    }
    wait()
  })`)
  if (workbenchRenderer === 'browser') {
    if (workbenchTabCount > 1) {
      extraBrowserResources = await evaluate(`(async () => {
        const workbench = document.querySelector('[data-workbench-session][data-active="true"]')
        const sessionId = workbench?.getAttribute('data-workbench-session')
        if (!sessionId) throw new Error('active workbench session not found')
        const resources = []
        for (let index = 1; index < ${workbenchTabCount}; index += 1) {
          const targets = ${JSON.stringify(browserTestUrls)}
          const target = new URL(targets[(index - 1) % targets.length])
          target.searchParams.set('larify_perf_tab', String(index))
          const url = target.href
          const resourceId = await window.bridge.invoke('resource:create', 'browser', sessionId, {
            url
          })
          resources.push({ resourceId, sessionId, url })
        }
        await Promise.all(resources.map(({ resourceId, url }) =>
          window.bridge.invoke('browser:navigate', sessionId, resourceId, url)
        ))
        return resources
      })()`)
      let extraBrowserStates = []
      const targetContent = []
      for (const resource of extraBrowserResources) {
        const browserViewMounted = await evaluate(`new Promise((resolve) => {
          let attempts = 0
          const check = () => {
            const view = document.querySelector(
              '[data-workbench-view="browser"][data-resource-id="${resource.resourceId}"]'
            )
            if (view) {
              resolve(true)
              return
            }
            attempts += 1
            if (attempts >= 100) {
              resolve(false)
              return
            }
            setTimeout(check, 50)
          }
          check()
        })`)
        if (!browserViewMounted) {
          throw new Error(`browser resource ${resource.resourceId} did not mount`)
        }
        await evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
          detail: {
            rendererId: 'browser',
            resourceId: ${resource.resourceId},
            sessionId: ${JSON.stringify(resource.sessionId)}
          }
        }))`)
        const browserViewActivated = await evaluate(`new Promise((resolve) => {
          let attempts = 0
          const check = () => {
            const view = document.querySelector(
              '[data-workbench-view="browser"][data-resource-id="${resource.resourceId}"]'
            )
            if (view?.getAttribute('data-active') === 'true') {
              resolve(true)
              return
            }
            attempts += 1
            if (attempts >= 100) {
              resolve(false)
              return
            }
            setTimeout(check, 50)
          }
          check()
        })`)
        if (!browserViewActivated) {
          throw new Error(`browser resource ${resource.resourceId} did not activate`)
        }
        let state = null
        for (let attempt = 0; attempt < 150; attempt += 1) {
          state = await evaluate(`window.bridge.invoke(
            'browser:getState',
            ${JSON.stringify(resource.sessionId)},
            ${resource.resourceId}
          )`)
          if (state && /^https?:/.test(state.url ?? '')) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        extraBrowserStates.push(state)
        const marker = new URL(resource.url).searchParams.get('larify_perf_tab')
        let content = null
        for (let attempt = 0; attempt < 150; attempt += 1) {
          const browserTargets = await fetch('http://127.0.0.1:9222/json/list').then((response) =>
            response.json()
          )
          const activeTarget = browserTargets.find(
            ({ id, type, url }) =>
              (type === 'page' || type === 'webview') &&
              !baselineExternalTargetIds.has(id) &&
              url.includes(`larify_perf_tab=${marker}`)
          )
          if (activeTarget) {
            content = await evaluateRemoteTarget(
              activeTarget.webSocketDebuggerUrl,
              `({
                nodes: document.querySelectorAll('*').length,
                textLength: document.body?.innerText?.length ?? 0,
                title: document.title,
                url: location.href
              })`
            ).catch(() => null)
            if (content && (content.nodes >= 500 || content.textLength >= 500)) break
          }
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        targetContent.push(content)
      }
      const unloadedExtraBrowsers = extraBrowserStates.filter(
        (state) => !state || !/^https?:/.test(state.url ?? '')
      )
      if (unloadedExtraBrowsers.length > 0) {
        throw new Error(
          `${workbenchTabCount - 1} heavy browser tabs did not finish loading: ${JSON.stringify(
            extraBrowserStates.map((state) => ({
              loading: state?.loading,
              title: state?.title,
              url: state?.url
            }))
          )}`
        )
      }
      let stressTargets = []
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const browserTargets = await fetch('http://127.0.0.1:9222/json/list').then((response) =>
          response.json()
        )
        stressTargets = browserTargets.filter(
          ({ id, type, url }) =>
            (type === 'page' || type === 'webview') &&
            !url.startsWith('http://localhost:') &&
            !baselineExternalTargetIds.has(id)
        )
        if (stressTargets.length >= workbenchTabCount - 1) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      if (stressTargets.length < workbenchTabCount - 1) {
        throw new Error(
          `expected ${workbenchTabCount - 1} heavy browser CDP targets, found ${stressTargets.length}`
        )
      }
      const emptyTargets = targetContent.filter(
        (content) => !content || (content.nodes < 500 && content.textLength < 500)
      )
      if (emptyTargets.length > 0) {
        throw new Error(
          `heavy browser tabs lack rendered content: ${JSON.stringify(targetContent)}`
        )
      }
    }
    if (includeFeatureTabs) {
      if (!workbenchCwd) throw new Error('LARIFY_TRACE_WORKBENCH_CWD is required for feature tabs')
      extraWorkbenchResources = await evaluate(`(async () => {
        const workbench = document.querySelector('[data-workbench-session][data-active="true"]')
        const sessionId = workbench?.getAttribute('data-workbench-session')
        if (!sessionId) throw new Error('active workbench session not found')
        const specifications = [
          { rendererId: 'workspace', options: { root: ${JSON.stringify(workbenchCwd)} } },
          { rendererId: 'changes', options: { root: ${JSON.stringify(workbenchCwd)} } },
          { rendererId: 'terminal', options: { cwd: ${JSON.stringify(workbenchCwd)} } }
        ]
        const resources = []
        for (const specification of specifications) {
          const resourceId = await window.bridge.invoke(
            'resource:create',
            specification.rendererId,
            sessionId,
            specification.options
          )
          resources.push({ ...specification, resourceId, sessionId })
          window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
            detail: { rendererId: specification.rendererId, resourceId, sessionId }
          }))
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        return resources
      })()`)
      const featureViewsReady = await evaluate(`new Promise((resolve) => {
        let attempts = 0
        const check = () => {
          const renderers = new Set(Array.from(document.querySelectorAll('[data-workbench-view]'))
            .map((view) => view.getAttribute('data-workbench-view')))
          if (['workspace', 'changes', 'terminal'].every((renderer) => renderers.has(renderer))) {
            resolve(true)
            return
          }
          attempts += 1
          if (attempts >= 100) {
            resolve(false)
            return
          }
          setTimeout(check, 50)
        }
        check()
      })`)
      if (!featureViewsReady) throw new Error('workspace, changes, or terminal view did not mount')
    }
    await evaluate(`(() => {
      const workbench = document.querySelector('[data-workbench-session][data-active="true"]')
      const sessionId = workbench?.getAttribute('data-workbench-session')
      if (!sessionId) throw new Error('active workbench session not found')
      window.__larifyCreatedBrowserResource = { pending: true }
      void window.bridge.invoke('resource:create', 'browser', sessionId, {
        url: ${JSON.stringify(browserTestUrl)}
      }).then(
        (resourceId) => { window.__larifyCreatedBrowserResource = { resourceId, sessionId } },
        (error) => { window.__larifyCreatedBrowserResource = { error: String(error) } }
      )
      return true
    })()`)
    for (let attempt = 0; attempt < 50; attempt += 1) {
      createdBrowserResource = await evaluate(`window.__larifyCreatedBrowserResource`)
      if (!createdBrowserResource?.pending) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!createdBrowserResource || createdBrowserResource.pending || createdBrowserResource.error) {
      throw new Error(
        `browser resource creation failed: ${createdBrowserResource?.error ?? 'timed out'}`
      )
    }
    await evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
      detail: {
        rendererId: 'browser',
        resourceId: ${createdBrowserResource.resourceId},
        sessionId: ${JSON.stringify(createdBrowserResource.sessionId)}
      }
    }))`)
    // Wait until the native tab exists before navigating explicitly. The running
    // app can create and mount the resource before its initial URL is observable;
    // navigating at that point makes this benchmark deterministic without racing
    // BrowserTab construction.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await evaluate(`window.bridge.invoke(
        'browser:getState',
        ${JSON.stringify(createdBrowserResource.sessionId)},
        ${createdBrowserResource.resourceId}
      )`)
      if (state) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const navigationStarted = await evaluate(`window.bridge.invoke(
      'browser:navigate',
      ${JSON.stringify(createdBrowserResource.sessionId)},
      ${createdBrowserResource.resourceId},
      ${JSON.stringify(browserTestUrl)}
    )`)
    if (!navigationStarted) throw new Error('browser benchmark navigation was rejected')
    let browserLoaded = false
    let lastBrowserState = null
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await evaluate(`(() => {
        window.__larifyBrowserStateCheck = { pending: true }
        void window.bridge.invoke(
          'browser:getState',
          ${JSON.stringify(createdBrowserResource.sessionId)},
          ${createdBrowserResource.resourceId}
        ).then(
          (state) => { window.__larifyBrowserStateCheck = { state } },
          (error) => { window.__larifyBrowserStateCheck = { error: String(error) } }
        )
      })()`)
      let stateCheck = null
      for (let poll = 0; poll < 10; poll += 1) {
        stateCheck = await evaluate(`window.__larifyBrowserStateCheck`)
        if (!stateCheck?.pending) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      lastBrowserState = stateCheck
      browserLoaded = await evaluate(`(() => {
        const view = document.querySelector(
          '[data-workbench-view="browser"][data-resource-id="${createdBrowserResource.resourceId}"]'
        )
        const rect = view?.getBoundingClientRect()
        return view?.getAttribute('data-active') === 'true' &&
          rect.width > 0 && rect.height > 0
      })()`)
      browserLoaded =
        browserLoaded && Boolean(stateCheck?.state?.url?.startsWith(expectedBrowserPrefix))
      if (browserLoaded) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!browserLoaded) {
      const browserState = await evaluate(`(() => {
        const view = document.querySelector(
          '[data-workbench-view="browser"][data-resource-id="${createdBrowserResource.resourceId}"]'
        )
        const address = view?.querySelector('[data-testid="browser-address"]')
        const rect = view?.getBoundingClientRect()
        return {
          active: view?.getAttribute('data-active'),
          address: address?.value ?? address?.textContent ?? null,
          rect: rect ? { width: rect.width, height: rect.height } : null,
          sessionId: view?.closest('[data-workbench-session]')?.getAttribute('data-workbench-session')
        }
      })()`)
      await evaluate(
        `void window.bridge.invoke('resource:close', ${createdBrowserResource.resourceId})`
      ).catch(() => undefined)
      createdBrowserResource = null
      throw new Error(
        `created browser search page did not become active: ${JSON.stringify({ browserState, lastBrowserState })}`
      )
    }
    if (action === 'stress-suite') {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const browserTargets = await fetch('http://127.0.0.1:9222/json/list').then((response) =>
          response.json()
        )
        stressBrowserTargets = browserTargets.filter(
          ({ id, type, url }) =>
            (type === 'page' || type === 'webview') &&
            Boolean(url) &&
            !url.startsWith('http://localhost:') &&
            !baselineExternalTargetIds.has(id)
        )
        if (stressBrowserTargets.length >= workbenchTabCount) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (stressBrowserTargets.length < workbenchTabCount) {
        throw new Error(
          `expected ${workbenchTabCount} stress browser targets, found ${stressBrowserTargets.length}`
        )
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const tabPosition = createdBrowserResource
    ? null
    : await evaluate(`(() => {
    const label = ${JSON.stringify(workbenchTab)}
    const renderer = ${JSON.stringify(workbenchRenderer)}
    const targetView = renderer
      ? Array.from(document.querySelectorAll('[data-workbench-view]')).find((candidate) => {
          const rect = candidate.getBoundingClientRect()
          return candidate.getAttribute('data-workbench-view') === renderer &&
            rect.width > 0 && rect.height > 0
        })
      : null
    const viewId = targetView?.getAttribute('data-view-id')
    const scope = targetView?.closest('.larify-workbench-pane') ?? document
    const button = viewId
      ? scope.querySelector('[data-tab-id="' + CSS.escape(viewId) + '"] .larify-workbench-tab-trigger')
      : Array.from(document.querySelectorAll('.larify-workbench-tab-trigger')).find(
          (candidate) => candidate.textContent?.trim() === label
        )
    if (!button) {
      throw new Error('workbench tab not found: ' + (renderer ?? label))
    }
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (tabPosition) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: tabPosition.x,
      y: tabPosition.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: tabPosition.x,
      y: tabPosition.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  const selected = await evaluate(`(() => {
    const label = ${JSON.stringify(workbenchTab)}
    const renderer = ${JSON.stringify(workbenchRenderer)}
    const activeView = Array.from(document.querySelectorAll('[data-workbench-view][data-active="true"]'))
      .find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
    if (renderer) return activeView?.getAttribute('data-workbench-view') === renderer &&
      (${createdBrowserResource?.resourceId ?? 'null'} === null ||
        Number(activeView?.getAttribute('data-resource-id')) === ${createdBrowserResource?.resourceId ?? 'null'})
    return Array.from(document.querySelectorAll('.larify-workbench-tab-trigger')).some(
      (candidate) => candidate.textContent?.trim() === label &&
        candidate.getAttribute('aria-selected') === 'true'
    )
  })()`)
  if (!selected) {
    const viewState =
      await evaluate(`Array.from(document.querySelectorAll('[data-workbench-view]')).map(
      (view) => ({
        active: view.getAttribute('data-active'),
        resourceId: view.getAttribute('data-resource-id'),
        renderer: view.getAttribute('data-workbench-view'),
        sessionId: view.closest('[data-workbench-session]')?.getAttribute('data-workbench-session'),
        visible: view.getBoundingClientRect().width > 0 && view.getBoundingClientRect().height > 0
      })
    )`)
    throw new Error(
      `workbench tab did not activate: ${workbenchRenderer ?? workbenchTab}; ${JSON.stringify(viewState)}`
    )
  }
}

if (action === 'resize') {
  await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
}
await new Promise((resolve) => setTimeout(resolve, 250))
await evaluate(`document.querySelector('#larify-trace-diagnostic-style')?.remove()`)
if (diagnosticStyle) {
  await evaluate(`(() => {
    const style = document.createElement('style')
    style.id = 'larify-trace-diagnostic-style'
    style.textContent = ${JSON.stringify(diagnosticStyle)}
    document.head.append(style)
  })()`)
}
await evaluate(`(() => {
    const original = window.bridge.sendSync
    const originalInvoke = window.bridge.invoke
    const originalDispatchEvent = window.dispatchEvent
    const ownPerformanceMeasure = Object.getOwnPropertyDescriptor(performance, 'measure')
    let initialBounds
    window.__larifyBrowserBoundsCalls = []
    window.__larifySessionMessageCalls = []
    window.__larifyRestoreBridgeDiagnostics = () => {
      window.bridge.sendSync = original
      window.bridge.invoke = originalInvoke
      window.dispatchEvent = originalDispatchEvent
      if (${disablePerformanceMeasure}) {
        if (ownPerformanceMeasure) Object.defineProperty(performance, 'measure', ownPerformanceMeasure)
        else delete performance.measure
      }
      delete window.__larifyFreezeBrowserBounds
      delete window.__larifyBrowserBoundsMode
    }
    window.__larifyFreezeBrowserBounds = ${freezeBrowserBounds}
    window.__larifyBrowserBoundsMode = ${JSON.stringify(browserBoundsMode)}
    if (${skipNativeLayout}) {
      window.dispatchEvent = function (event) {
        if (event?.type === 'larify:native-layout') return true
        return originalDispatchEvent.call(this, event)
      }
    }
    if (${disablePerformanceMeasure}) {
      Object.defineProperty(performance, 'measure', {
        configurable: true,
        value: () => undefined
      })
    }
    window.bridge.sendSync = (channel, ...args) => {
      if (channel === 'browser:setBoundsSync') {
        const request = args[0]
        const bounds = request?.bounds ?? args[2]
        initialBounds ??= bounds
        window.__larifyBrowserBoundsCalls.push({ time: performance.now(), bounds: { ...bounds } })
        if (${skipBrowserBounds}) return { duration: 0 }
        const diagnosticBounds = ${freezeBrowserBounds} ? initialBounds : {
          ...bounds,
          x: ${JSON.stringify(browserBoundsMode)} === 'size-only' ? initialBounds.x : bounds.x,
          y: ${JSON.stringify(browserBoundsMode)} === 'size-only' ? initialBounds.y : bounds.y,
          width: ${freezeBrowserSize} ? initialBounds.width : bounds.width,
          height: ${freezeBrowserSize} ? initialBounds.height : bounds.height
        }
        if (${JSON.stringify(browserBoundsMode)} === 'position-only') {
          diagnosticBounds.width = initialBounds.width
          diagnosticBounds.height = initialBounds.height
        }
        if (request?.bounds) args[0] = { ...request, bounds: diagnosticBounds }
        else args[2] = diagnosticBounds
      }
      return original(channel, ...args)
    }
    window.bridge.invoke = async (channel, ...args) => {
      if (channel !== 'session:msgs') return originalInvoke(channel, ...args)
      const call = { start: performance.now(), args: [...args] }
      window.__larifySessionMessageCalls.push(call)
      try {
        const result = await originalInvoke(channel, ...args)
        call.end = performance.now()
        call.count = Array.isArray(result) ? result.length : null
        return result
      } catch (error) {
        call.end = performance.now()
        call.error = error instanceof Error ? error.message : String(error)
        throw error
      }
    }
  })()`)
const position = await evaluate(
  action.startsWith('scroll')
    ? `(() => {
        const log = Array.from(document.querySelectorAll('[role="log"]')).sort(
          (left, right) => right.clientHeight - left.clientHeight
        )[0]
        if (!log) throw new Error('message log not found')
        const rect = log.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })()`
    : action === 'stress-suite'
      ? `({ x: 0, y: 0 })`
      : action === 'switch-tabs'
        ? `({ x: 0, y: 0 })`
        : action === 'hover-navigation'
          ? `(() => {
          const navigation = document.querySelector('[aria-label="Navigation"]')
          if (!navigation) throw new Error('navigation region not found')
          const rect = navigation.getBoundingClientRect()
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + 24,
            minX: rect.left + 16,
            maxX: rect.right - 16,
            minY: rect.top + 16,
            maxY: rect.bottom - 16
          }
        })()`
          : resizeTarget === 'navigation'
            ? `(() => {
          const handle = Array.from(document.querySelectorAll('.larify-allotment .sash-vertical'))
            .find((candidate) => {
              const rect = candidate.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== 'hidden'
            })
          if (!handle) throw new Error('navigation resize handle not found')
          window.__larifyTraceResizeHandle = handle
          const rect = handle.getBoundingClientRect()
          return {
            x: rect.x + rect.width / 2,
            y: Math.min(500, rect.height / 2),
            minX: 180,
            maxX: 520
          }
        })()`
            : `(() => {
        const visibleLog = Array.from(document.querySelectorAll('[role="log"]'))
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect()
            const rightRect = right.getBoundingClientRect()
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height
          })[0]
        const handle = Array.from(document.querySelectorAll('.larify-workbench-resize-handle'))
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== 'hidden'
          })
          .sort((left, right) => right.getBoundingClientRect().height - left.getBoundingClientRect().height)[0]
        if (!handle) throw new Error('workbench resize handle not found')
        window.__larifyTraceResizeHandle = handle
        const rect = handle.getBoundingClientRect()
        const containerRect = handle.closest('.larify-workbench-split').getBoundingClientRect()
        const interactionMin = Number(handle.dataset.interactionMinSize)
        const workbenchMin = Number(handle.dataset.workbenchMinSize)
        return {
          x: rect.x + rect.width / 2,
          y: Math.min(500, rect.height / 2),
          minX: containerRect.left + interactionMin,
          maxX: containerRect.right - workbenchMin
        }
      })()`
)
const pageState = await evaluate(`(() => {
  const scroller = Array.from(document.querySelectorAll('[role="log"]')).sort(
    (left, right) => right.clientHeight - left.clientHeight
  )[0]
  return {
    title: document.querySelector('header')?.textContent ?? document.title,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollTop: scroller?.scrollTop ?? null,
    scrollHeight: scroller?.scrollHeight ?? null,
    clientHeight: scroller?.clientHeight ?? null,
    messageCount: document.querySelectorAll('[data-message-index]').length,
    domNodeCount: document.querySelectorAll('*').length,
    logs: Array.from(document.querySelectorAll('[role="log"]')).map((log) => ({
      classes: log.className,
      childCount: log.childElementCount,
      descendants: log.querySelectorAll('*').length,
      sample: Array.from(log.querySelectorAll('div')).slice(0, 12).map((element) => ({
        classes: element.className,
        attributes: Array.from(element.attributes).reduce(
          (result, attribute) => ({ ...result, [attribute.name]: attribute.value }),
          {}
        ),
        text: element.textContent?.trim().slice(0, 80) ?? ''
      }))
    })),
    sashes: Array.from(document.querySelectorAll('.sash')).map((sash) => ({
      classes: sash.className,
      ariaOrientation: sash.getAttribute('aria-orientation'),
      rect: sash.getBoundingClientRect().toJSON()
    })),
    browserViewports: Array.from(document.querySelectorAll('[data-testid="browser-viewport"]')).map(
      (viewport) => ({
        active: viewport.closest('[data-workbench-view]')?.getAttribute('data-active') === 'true',
        rect: viewport.getBoundingClientRect().toJSON(),
        viewId: viewport.closest('[data-workbench-view]')?.getAttribute('data-view-id')
      })
    ),
    workbenchTabs: Array.from(document.querySelectorAll('.larify-workbench-tab')).map((tab) => ({
      id: tab.getAttribute('data-tab-id'),
      selected: tab.querySelector('[aria-selected="true"]') !== null,
      title: tab.querySelector('.larify-workbench-tab-title')?.textContent?.trim()
    })),
    workbenchViews: Array.from(document.querySelectorAll('[data-workbench-view]')).map((view) => ({
      active: view.getAttribute('data-active') === 'true',
      id: view.getAttribute('data-view-id'),
      renderer: view.getAttribute('data-workbench-view')
    })),
    hiddenWorkbenchViewCount: document.querySelectorAll(
      '[data-workbench-view][aria-hidden="true"]'
    ).length
  }
})()`)

let pressed = false
let failure
let inputCount = 0
let cpuProfile = null
let cpuProfileStartedAt = null
let cpuProfileStoppedAt = null
try {
  if (action.startsWith('scroll')) {
    // Remove listeners left by older revisions of this long-lived CDP harness.
    // `getEventListeners` is only exposed through the DevTools command-line API.
    await send('Runtime.evaluate', {
      expression: `(() => {
        const scroller = Array.from(document.querySelectorAll('[role="log"]')).sort(
          (left, right) => right.clientHeight - left.clientHeight
        )[0]
        if (!scroller) return 0
        const listeners = (getEventListeners(scroller).scroll ?? []).filter(({ listener }) =>
          String(listener).includes('__larifyScrollEvents')
        )
        for (const { listener, useCapture } of listeners) {
          scroller.removeEventListener('scroll', listener, useCapture)
        }
        return listeners.length
      })()`,
      includeCommandLineAPI: true,
      returnByValue: true
    })
  }
  if (cpuProfileEnabled) {
    await send('Profiler.enable')
    await send('Profiler.setSamplingInterval', { interval: 100 })
    await send('Profiler.start')
    cpuProfileStartedAt = await evaluate(`performance.now()`)
  }
  if (tracingEnabled) {
    await send('Tracing.start', {
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'blink.user_timing'
      ].join(','),
      transferMode: 'ReportEvents'
    })
  }
  await evaluate(`(() => {
    window.__larifyFrameTimes = []
    window.__larifyScrollEvents = []
    window.__larifyMessageMutations = []
    globalThis.__larifyStreamdownCacheHits = 0
    globalThis.__larifyStreamdownCacheMisses = 0
    globalThis.__larifyStreamdownAstCacheHits = 0
    globalThis.__larifyStreamdownAstCacheMisses = 0
    globalThis.__larifyDisableStreamdownAstCache = ${disableStreamdownAstCache}
    window.__larifyBrowserBoundsSamples = []
    window.__larifyCaptureBrowserBounds = true
    window.__larifyBrowserBoundsSampleListener ??= (event) => {
      window.__larifyBrowserBoundsSamples.push({
        at: performance.now(),
        ...event.detail
      })
    }
    window.addEventListener(
      'larify:browser-bounds-sample',
      window.__larifyBrowserBoundsSampleListener
    )
    window.__larifyExpectedHandleX = null
    window.__larifyReceivedPointerX = null
    window.__larifyReceivedPointerAt = null
    window.__larifyPointerSampleListener ??= (event) => {
      if (event.buttons !== 1) return
      window.__larifyReceivedPointerX = event.clientX
      window.__larifyReceivedPointerAt = performance.now()
    }
    window.addEventListener('pointermove', window.__larifyPointerSampleListener, true)
    window.__larifyLongAnimationFrames = []
    window.__larifyLongAnimationFrameObserver?.disconnect()
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      window.__larifyLongAnimationFrameObserver = new PerformanceObserver((list) => {
        window.__larifyLongAnimationFrames.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration: entry.blockingDuration,
          scripts: entry.scripts.map((script) => ({
            duration: script.duration,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            invoker: script.invoker,
            sourceFunctionName: script.sourceFunctionName,
            sourceURL: script.sourceURL
          }))
        })))
      })
      window.__larifyLongAnimationFrameObserver.observe({ type: 'long-animation-frame', buffered: false })
    }
    window.__larifyFrameSampling = true
    const generation = (window.__larifyFrameSampleGeneration ?? 0) + 1
    window.__larifyFrameSampleGeneration = generation
    const scrolling = ${action.startsWith('scroll')}
    const trackedScroller = scrolling
      ? Array.from(document.querySelectorAll('[role="log"]')).sort(
          (left, right) => {
            const leftRect = left.getBoundingClientRect()
            const rightRect = right.getBoundingClientRect()
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height
          }
        )[0]
      : null
    let lastScrollEventAt = 0
    if (window.__larifyScrollSampleTarget && window.__larifyScrollSampleListener) {
      window.__larifyScrollSampleTarget.removeEventListener(
        'scroll',
        window.__larifyScrollSampleListener
      )
    }
    window.__larifyScrollSampleTarget = trackedScroller
    window.__larifyScrollSampleListener = () => {
      lastScrollEventAt = performance.now()
      // Do not read layout-backed properties here. A synchronous scrollTop read can
      // wait on Chromium's compositor and make the measurement perturb the scroll
      // path it is supposed to observe. The final position is sampled after tracing.
      window.__larifyScrollEvents.push({ at: lastScrollEventAt })
    }
    trackedScroller?.addEventListener('scroll', window.__larifyScrollSampleListener, {
      passive: true
    })
    const trackedHandle = scrolling ? null : window.__larifyTraceResizeHandle
    const renderedMessageIndexes = new Set(
      scrolling
        ? Array.from(trackedScroller.querySelectorAll('[data-message-index]'), (element) =>
            Number(element.getAttribute('data-message-index'))
          ).filter(Number.isFinite)
        : []
    )
    window.__larifyMessageMutationObserver?.disconnect()
    if (scrolling) {
      window.__larifyMessageMutationObserver = new MutationObserver((records) => {
        const added = []
        const removed = []
        const collect = (node, target) => {
          if (!(node instanceof Element)) return
          const elements = node.matches('[data-message-index]')
            ? [node]
            : Array.from(node.querySelectorAll('[data-message-index]'))
          target.push(...elements)
        }
        for (const record of records) {
          for (const node of record.addedNodes) collect(node, added)
          for (const node of record.removedNodes) collect(node, removed)
        }
        if (added.length > 0 || removed.length > 0) {
          for (const element of removed) {
            renderedMessageIndexes.delete(Number(element.getAttribute('data-message-index')))
          }
          for (const element of added) {
            renderedMessageIndexes.add(Number(element.getAttribute('data-message-index')))
          }
          window.__larifyMessageMutations.push({ at: performance.now(), added, removed })
        }
      })
      window.__larifyMessageMutationObserver.observe(trackedScroller, {
        childList: true,
        subtree: true
      })
    }
    const trackedBrowserViewport = scrolling
      ? null
      : Array.from(document.querySelectorAll('[data-testid="browser-viewport"]')).find(
          (viewport) => {
            const rect = viewport.getBoundingClientRect()
            return viewport.closest('[data-workbench-view]')?.getAttribute('data-active') === 'true' &&
              rect.width > 0 && rect.height > 0
          }
        )
    let previous = performance.now()
    const sample = (now) => {
      if (!window.__larifyFrameSampling || window.__larifyFrameSampleGeneration !== generation) return
      const handleRect = trackedHandle?.getBoundingClientRect()
      const browserRect = trackedBrowserViewport?.getBoundingClientRect()
      const delta = now - previous
      window.__larifyFrameTimes.push({
        at: now,
        delta,
        phase: window.__larifyPerfPhase ?? null,
        scrolling: scrolling && now - lastScrollEventAt < 100,
        handleX: handleRect ? handleRect.left + handleRect.width / 2 : null,
        expectedHandleX: window.__larifyExpectedHandleX,
        receivedPointerX: window.__larifyReceivedPointerX,
        receivedPointerAt: window.__larifyReceivedPointerAt,
        browserViewport: browserRect
          ? { x: browserRect.x, width: browserRect.width }
          : null,
        visibleSkeletonCount: 0,
        renderedMessageCount: renderedMessageIndexes.size,
        renderedRange: renderedMessageIndexes.size > 0
          ? {
              startIndex: Math.min(...renderedMessageIndexes),
              endIndex: Math.max(...renderedMessageIndexes)
            }
          : null
      })
      previous = now
      if (window.__larifyFrameTimes.length < ${frameSampleLimit}) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })()`)
  if (action.startsWith('scroll')) {
    if (
      action === 'scroll-gesture' ||
      action === 'scroll-bidirectional' ||
      action === 'scroll-loaded' ||
      action === 'scroll-loaded-fast' ||
      action === 'scroll-loaded-up'
    ) {
      await evaluate(`(() => {
        const scroller = Array.from(document.querySelectorAll('[role="log"]')).sort(
          (left, right) => right.clientHeight - left.clientHeight
        )[0]
        scroller.scrollTop = scroller.scrollHeight
      })()`)
      const loadedScroll =
        action === 'scroll-loaded' ||
        action === 'scroll-loaded-fast' ||
        action === 'scroll-loaded-up'
      const distance =
        action === 'scroll-loaded-fast'
          ? 2_400
          : loadedScroll
            ? 1_200
            : Number(process.env.LARIFY_TRACE_SCROLL_DISTANCE ?? 30_000)
      const speed = action === 'scroll-loaded-fast' ? 6_000 : loadedScroll ? 1_500 : 4_000
      await send('Input.synthesizeScrollGesture', {
        x: position.x,
        y: position.y,
        yDistance: distance,
        speed,
        gestureSourceType: 'mouse'
      }, Math.ceil(Math.abs(distance) / speed * 1_000) + 30_000)
      if (
        action === 'scroll-bidirectional' ||
        action === 'scroll-loaded' ||
        action === 'scroll-loaded-fast'
      ) {
        await send('Input.synthesizeScrollGesture', {
          x: position.x,
          y: position.y,
          yDistance: -distance,
          speed,
          gestureSourceType: 'mouse'
        }, Math.ceil(Math.abs(distance) / speed * 1_000) + 30_000)
      }
    } else if (action === 'scroll-programmatic') {
      await evaluate(`new Promise((resolve) => {
        const scroller = Array.from(document.querySelectorAll('[role="log"]')).sort(
          (left, right) => right.clientHeight - left.clientHeight
        )[0]
        if (!scroller) throw new Error('message log not found')
        scroller.scrollTop = scroller.scrollHeight
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }))
        let frames = 0
        let direction = -1
        let settledTopFrames = 0
        let lastScrollHeight = scroller.scrollHeight
        const scroll = () => {
          scroller.scrollTop += direction * 400
          frames += 1
          if (direction < 0 && scroller.scrollTop <= 0) {
            const firstRenderedIndex = Math.min(
              ...Array.from(scroller.querySelectorAll('[data-item-index]'), (item) =>
                Number(item.getAttribute('data-item-index'))
              ).filter(Number.isFinite)
            )
            if (firstRenderedIndex > 0) {
              settledTopFrames = 0
              requestAnimationFrame(scroll)
              return
            }
            if (scroller.scrollHeight !== lastScrollHeight) {
              lastScrollHeight = scroller.scrollHeight
              settledTopFrames = 0
            } else {
              settledTopFrames += 1
            }
            if (settledTopFrames >= ${programmaticTopSettleFrames}) direction = 1
          }
          if ((direction > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) || frames >= ${programmaticScrollMaxFrames}) {
            resolve(frames)
          } else requestAnimationFrame(scroll)
        }
        requestAnimationFrame(scroll)
      })`)
    } else if (action === 'scroll-passive') {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
    } else {
      const wheelDeltas =
        action === 'scroll-long'
          ? Array.from({ length: 300 }, () => -200)
          : [...Array.from({ length: 24 }, () => -120), ...Array.from({ length: 24 }, () => 120)]
      for (const deltaY of wheelDeltas) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: position.x,
          y: position.y,
          deltaX: 0,
          deltaY
        })
        inputCount += 1
        await new Promise((resolve) => setTimeout(resolve, action === 'scroll-long' ? 16 : 8))
      }
    }
  } else if (action === 'stress-suite') {
    const setPhase = async (phase) => {
      await evaluate(`window.__larifyPerfPhase = ${JSON.stringify(phase)}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const dragHandle = async (selector, minimumX, maximumX) => {
      if (selector === '.larify-workbench-resize-handle') {
        await evaluate(`new Promise((resolve) => {
          document.querySelector('[aria-label="显示工作台"]')?.click()
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        })`)
      }
      const handle = await evaluate(`(() => {
        const candidates = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== 'hidden'
          })
        const candidate = candidates.sort(
          (left, right) => right.getBoundingClientRect().height - left.getBoundingClientRect().height
        )[0]
        if (!candidate) throw new Error('stress resize handle not found: ' + ${JSON.stringify(selector)})
        const rect = candidate.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: Math.min(500, rect.height / 2) }
      })()`)
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: handle.x,
        y: handle.y,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      for (let index = 0; index < 120; index += 1) {
        const x = Math.max(
          minimumX,
          Math.min(maximumX, handle.x + 120 * Math.sin((index / 30) * Math.PI))
        )
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y: handle.y,
          button: 'left',
          buttons: 1
        })
        inputCount += 1
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: handle.x,
        y: handle.y,
        button: 'left',
        buttons: 0
      })
    }

    await setPhase('navigation-resize')
    await dragHandle('.larify-allotment .sash-vertical', 180, 520)
    await setPhase('workbench-resize')
    await dragHandle('.larify-workbench-resize-handle', 700, 2_300)

    await setPhase('tab-switch')
    for (let index = 0; index < 60; index += 1) {
      await evaluate(`(() => {
        const tabs = Array.from(document.querySelectorAll('.larify-workbench-tab [role="tab"]'))
        if (tabs.length < ${workbenchTabCount}) {
          throw new Error('expected ${workbenchTabCount} workbench tabs, found ' + tabs.length)
        }
        tabs[${index} % tabs.length].click()
      })()`)
      inputCount += 1
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    await setPhase('toggle-controls')
    const toggleResults = await evaluate(`(async () => {
      const buttons = Array.from(document.querySelectorAll('button[aria-expanded]')).filter(
        (button) => {
          const rect = button.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && !button.disabled
        }
      )
      const results = []
      for (const button of buttons) {
        const startedAt = performance.now()
        const label = button.getAttribute('aria-label') || button.textContent?.trim().slice(0, 80)
        button.click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        button.click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        results.push({ label, duration: performance.now() - startedAt })
      }
      return results
    })()`)
    const toggleCount = toggleResults.length
    inputCount += toggleCount * 2

    await setPhase('app-scrollables')
    const scrollables = await evaluate(`(() => {
      let index = 0
      return Array.from(document.querySelectorAll('*')).flatMap((element) => {
        const style = getComputedStyle(element)
        const vertical = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight
        const horizontal = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth
        const rect = element.getBoundingClientRect()
        if ((!vertical && !horizontal) || rect.width <= 0 || rect.height <= 0) return []
        const id = 'larify-perf-scroll-' + index++
        element.dataset.larifyPerfScroll = id
        return [{ id, vertical, horizontal, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }]
      })
    })()`)
    for (const scroller of scrollables) {
      await evaluate(`(() => {
        const element = document.querySelector('[data-larify-perf-scroll="${scroller.id}"]')
        if (!element) return
        if (${scroller.vertical}) element.scrollTop = element.scrollHeight
        if (${scroller.horizontal}) element.scrollLeft = element.scrollWidth
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 80))
      await evaluate(`(() => {
        const element = document.querySelector('[data-larify-perf-scroll="${scroller.id}"]')
        if (!element) return
        element.scrollTop = 0
        element.scrollLeft = 0
      })()`)
      inputCount += 2
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    const featureScrollableResults = []
    for (const resource of extraWorkbenchResources) {
      await setPhase(`feature-${resource.rendererId}-scroll`)
      await evaluate(`window.dispatchEvent(new CustomEvent('larify:workbench-select-resource', {
        detail: {
          rendererId: ${JSON.stringify(resource.rendererId)},
          resourceId: ${resource.resourceId},
          sessionId: ${JSON.stringify(resource.sessionId)}
        }
      }))`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      const featureScrollables = await evaluate(`(() => {
        const activeView = document.querySelector('[data-workbench-view][data-active="true"]')
        if (!activeView) return []
        return Array.from(activeView.querySelectorAll('*')).flatMap((element, index) => {
          const style = getComputedStyle(element)
          const vertical = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight
          const horizontal = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth
          if (!vertical && !horizontal) return []
          if (vertical) element.scrollTop = element.scrollHeight
          if (horizontal) element.scrollLeft = element.scrollWidth
          return [{
            index,
            vertical,
            horizontal,
            tag: element.tagName,
            className: String(element.className ?? '').slice(0, 120)
          }]
        })
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      featureScrollableResults.push({
        renderer: resource.rendererId,
        scrollables: featureScrollables
      })
      inputCount += featureScrollables.length
    }
    await setPhase('browser-scrollables')
    const matchingBrowserTargets = stressBrowserTargets
    const browserScrollFailures = []
    for (const target of matchingBrowserTargets) {
      await evaluateRemoteTarget(
        target.webSocketDebuggerUrl,
        `(() => {
          const scrollHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0
          )
          window.scrollTo(0, scrollHeight)
          window.scrollTo(0, 0)
          return { scrollHeight }
        })()`
      ).catch((error) => {
        browserScrollFailures.push({ url: target.url, error: String(error) })
      })
      inputCount += 2
    }
    await evaluate(`window.__larifyStressCoverage = ${JSON.stringify({})}`)
    await evaluate(`window.__larifyStressCoverage = {
      toggleCount: ${toggleCount},
      toggleResults: ${JSON.stringify(toggleResults)},
      scrollableCount: ${scrollables.length} + ${JSON.stringify(featureScrollableResults)}
        .reduce((count, result) => count + result.scrollables.length, 0),
      scrollables: ${JSON.stringify(scrollables)},
      featureScrollableResults: ${JSON.stringify(featureScrollableResults)},
      browserScrollableCount: ${matchingBrowserTargets.length},
      browserScrollFailures: ${JSON.stringify(browserScrollFailures)}
    }`)
  } else if (action === 'switch-tabs') {
    for (let index = 0; index < resizeSteps; index += 1) {
      await evaluate(`(() => {
        const tabs = Array.from(document.querySelectorAll('.larify-workbench-tab [role="tab"]'))
        if (tabs.length < 2) throw new Error('at least two workbench tabs are required')
        tabs[${index} % tabs.length].click()
      })()`)
      inputCount += 1
      await new Promise((resolve) => setTimeout(resolve, 32))
    }
  } else if (action === 'hover-navigation') {
    const hoverSteps = resizeSteps
    for (let index = 0; index < hoverSteps; index += 1) {
      const progress = index / Math.max(1, hoverSteps - 1)
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.minX + (position.maxX - position.minX) * (0.5 + 0.5 * Math.sin(index / 6)),
        y: position.minY + (position.maxY - position.minY) * progress
      })
      inputCount += 1
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
  } else {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: position.x,
      y: position.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    pressed = true
    const fastResize = action === 'resize-fast'
    const offsets =
      action === 'resize-long' || fastResize
        ? Array.from(
            { length: resizeSteps },
            (_, index) => -(fastResize ? 360 : 120) * Math.sin((index / 30) * Math.PI)
          )
        : [-12, -24, -36, -24, -12, 0]
    const moveInterval = fastResize ? 8 : 16
    await evaluate(`(() => {
      const offsets = ${JSON.stringify(offsets)}
      const startedAt = performance.now()
      clearInterval(window.__larifyExpectedHandleTimer)
      window.__larifyExpectedHandleTimer = setInterval(() => {
        const index = Math.min(
          offsets.length - 1,
          Math.floor((performance.now() - startedAt) / ${moveInterval})
        )
        window.__larifyExpectedHandleX = Math.max(
          ${position.minX},
          Math.min(${position.x} + offsets[index], ${position.maxX})
        )
        if (index === offsets.length - 1) clearInterval(window.__larifyExpectedHandleTimer)
      }, 1)
    })()`)
    const pendingMoves = []
    for (const offset of offsets) {
      const dispatchMove = send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.x + offset,
        y: position.y,
        button: 'left',
        buttons: 1
      })
      pendingMoves.push(dispatchMove)
      inputCount += 1
      await new Promise((resolve) => setTimeout(resolve, moveInterval))
    }
    await Promise.all(pendingMoves)
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
} finally {
  await evaluate(`window.__larifyFrameSampling = false`).catch(() => undefined)
  if (pressed) {
    await send(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        x: position.x,
        y: position.y,
        button: 'left',
        buttons: 0
      },
      2_000
    ).catch(() => undefined)
  }
  if (cpuProfileEnabled) {
    cpuProfileStoppedAt = await evaluate(`performance.now()`).catch(() => null)
    cpuProfile = (await send('Profiler.stop', {}, 5_000).catch(() => null))?.profile ?? null
    await send('Profiler.disable').catch(() => undefined)
  }
  if (tracingEnabled) {
    await send('Tracing.end', {}, 2_000).catch(() => undefined)
    const traceCompleted = await Promise.race([
      tracingDone.then(() => true),
      new Promise((resolve) =>
        setTimeout(() => resolve(false), action === 'stress-suite' ? 120_000 : 15_000)
      )
    ])
    if (!traceCompleted && !failure) failure = 'Tracing.tracingComplete timed out'
  }
  const frameTimes = await evaluate(`window.__larifyFrameTimes ?? []`).catch(() => [])
  const scrollEvents = await evaluate(`window.__larifyScrollEvents ?? []`).catch(() => [])
  const messageMutations = await evaluate(`(() => {
    window.__larifyMessageMutationObserver?.disconnect()
    const describe = (element) => ({
      index: Number(element.getAttribute('data-message-index')),
      characters: element.textContent?.length ?? 0,
      codeBlocks: element.querySelectorAll('pre').length,
      tables: element.querySelectorAll('table').length,
      tools: element.querySelectorAll('[data-tool], [data-testid*="tool"]').length,
      markdownBlocks: element.querySelectorAll('[data-streamdown]').length
    })
    return (window.__larifyMessageMutations ?? []).map(({ at, added, removed }) => ({
      at,
      added: added.map(describe),
      removed: removed.map(describe)
    }))
  })()`).catch(() => [])
  const browserBoundsCalls = await evaluate(`window.__larifyBrowserBoundsCalls ?? []`).catch(
    () => []
  )
  const browserBoundsSamples = await evaluate(`window.__larifyBrowserBoundsSamples ?? []`).catch(
    () => []
  )
  const sessionMessageCalls = await evaluate(`window.__larifySessionMessageCalls ?? []`).catch(
    () => []
  )
  const longAnimationFrames = await evaluate(
    `window.__larifyLongAnimationFrameObserver?.disconnect(); window.__larifyLongAnimationFrames ?? []`
  ).catch(() => [])
  const finalPageState = await evaluate(`(() => {
    const scroller = Array.from(document.querySelectorAll('[role="log"]')).sort(
      (left, right) => right.clientHeight - left.clientHeight
    )[0]
    return {
      scrollTop: scroller?.scrollTop ?? null,
      scrollHeight: scroller?.scrollHeight ?? null,
      clientHeight: scroller?.clientHeight ?? null,
      messageCount: document.querySelectorAll('[data-message-index]').length,
      placeholderCount: document.querySelectorAll('[data-scroll-placeholder]').length,
      visiblePlaceholderCount: Array.from(
        document.querySelectorAll('[data-scroll-placeholder]')
      ).filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      }).length,
      visibleSkeletonCount: Array.from(
        document.querySelectorAll('[data-scroll-placeholder]')
      ).filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight && element.childElementCount > 0
      }).length,
      visibleSkeletonHtml: Array.from(
        document.querySelectorAll('[data-scroll-placeholder]')
      ).filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight && element.childElementCount > 0
      }).slice(0, 2).map((element) => element.outerHTML),
      renderedMessages: Array.from(document.querySelectorAll('[data-message-index]')).map(
        (element) => ({
          index: Number(element.getAttribute('data-message-index')),
          classes: element.className,
          text: element.textContent?.trim().slice(0, 240) ?? '',
          markers: Array.from(element.querySelectorAll('[data-testid], [data-tool], pre, code'))
            .slice(0, 12)
            .map((child) => ({
              tag: child.tagName,
              testId: child.getAttribute('data-testid'),
              tool: child.getAttribute('data-tool'),
              classes: child.className
            }))
        })
      )
    }
  })()`).catch(() => null)
  if (hiddenBrowserResource?.activeResourceId != null) {
    await evaluate(`window.bridge.invoke(
      'browser:setVisible',
      ${JSON.stringify(hiddenBrowserResource.sessionId)},
      ${hiddenBrowserResource.activeResourceId},
      true
    )`).catch(() => undefined)
  }
  await writeFile(
    output,
    JSON.stringify({
      traceEvents,
      metadata: {
        action,
        threadTitle,
        workbenchTab,
        workbenchRenderer,
        skipBrowserBounds,
        createdBrowserResource,
        failure,
        frameTimes,
        scrollEvents,
        messageMutations,
        browserBoundsCalls,
        browserBoundsSamples,
        sessionMessageCalls,
        longAnimationFrames,
        streamdownCache: await evaluate(`({
          hits: globalThis.__larifyStreamdownCacheHits ?? 0,
          misses: globalThis.__larifyStreamdownCacheMisses ?? 0,
          astHits: globalThis.__larifyStreamdownAstCacheHits ?? 0,
          astMisses: globalThis.__larifyStreamdownAstCacheMisses ?? 0,
          astDisabled: globalThis.__larifyDisableStreamdownAstCache ?? false
        })`).catch(() => null),
        stressCoverage: await evaluate(`window.__larifyStressCoverage ?? null`).catch(() => null),
        cpuProfile,
        cpuProfileStartedAt,
        cpuProfileStoppedAt,
        inputCount,
        pageState,
        finalPageState
      }
    })
  )
  await evaluate(`document.querySelector('#larify-trace-diagnostic-style')?.remove()`).catch(
    () => undefined
  )
  await evaluate(`clearInterval(window.__larifyExpectedHandleTimer)`).catch(() => undefined)
  await evaluate(
    `window.__larifyRestoreBridgeDiagnostics?.(); delete window.__larifyRestoreBridgeDiagnostics`
  ).catch(() => undefined)
  if (createdBrowserResource) {
    await evaluate(
      `window.bridge.invoke('resource:close', ${createdBrowserResource.resourceId})`
    ).catch(() => undefined)
  }
  for (const resource of extraBrowserResources) {
    await evaluate(`window.bridge.invoke('resource:close', ${resource.resourceId})`).catch(
      () => undefined
    )
  }
  for (const resource of extraWorkbenchResources) {
    await evaluate(`window.bridge.invoke('resource:close', ${resource.resourceId})`).catch(
      () => undefined
    )
  }
  if (syntheticScriptIdentifier) {
    await send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: syntheticScriptIdentifier
    }).catch(() => undefined)
    await send('Page.reload', { ignoreCache: false }).catch(() => undefined)
  }
  socket.close()
}

console.log(JSON.stringify({ events: traceEvents.length, failure, output }))
