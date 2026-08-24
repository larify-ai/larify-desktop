import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Code2Icon, ExternalLinkIcon, EyeIcon, FilesIcon } from 'lucide-react'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import {
  type WorkbenchAnimationState,
  workbenchAnimationEvent,
  workbenchStateRequestEvent
} from '@renderer/app/layout/native-layout'
import { Button } from '@renderer/components/ui/button'
import { useWorkbenchTabActions } from '@renderer/app/workbench/workbench-tab-actions'
import {
  useWorkbenchActivation,
  useWorkbenchActivationStore
} from '@renderer/app/workbench/workbench-activation'
import { WorkspaceTree } from './explorer/workspace-tree'
import { useGitDecorations } from './changes/use-git-decorations'
import { useWorkspaceExplorer } from './explorer/use-workspace-explorer'
import { createPathChangeTree } from './changes/git-change-tree'
import { WorkspaceLayout, workspaceNavigatorDefaultWidth } from './layout/workspace-layout'
import { EmptyFilePreview } from './preview/empty-file-preview'
import {
  workspaceMarkdownOpenExternalEvent,
  workspaceMarkdownOpenFileEvent
} from './preview/markdown-navigation'
import {
  WORKSPACE_NAVIGATION_EVENT,
  takeWorkspaceNavigation,
  type WorkspaceNavigationRequest
} from './workspace-navigation'
import { workspaceClient } from './workspace-client'
import type { FileDescriptor } from '../shared/types'

const loadFilePreview = async (): Promise<{
  default: typeof import('./preview/file-preview').FilePreview
}> => {
  const { FilePreview } = await import('./preview/file-preview')
  return { default: FilePreview }
}

const FilePreview = lazy(loadFilePreview)

function ActivatedFilePreview(
  props: Omit<React.ComponentProps<typeof FilePreview>, 'active'> & { enabled: boolean }
): React.JSX.Element {
  const { enabled, ...previewProps } = props
  const active = useWorkbenchActivation()
  return <FilePreview {...previewProps} active={active && enabled} />
}

type WorkspaceViewProps = Omit<WorkbenchRendererProps, 'cwd'>

const isMarkdownPath = (path: string): boolean => /\.(?:md|markdown)$/i.test(path)
const opensInBrowser = ({ binary, mime }: FileDescriptor): boolean =>
  mime === 'application/pdf' ||
  (binary && (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')))

export function WorkspaceView({
  active = false,
  resourceId,
  sessionId,
  updateTab
}: WorkspaceViewProps): React.JSX.Element {
  const activationStore = useWorkbenchActivationStore()
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview')
  const [navigatorWidth, setNavigatorWidth] = useState(workspaceNavigatorDefaultWidth)
  const [workbenchAnimating, setWorkbenchAnimating] = useState(false)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const [lockedPreviewWidth, setLockedPreviewWidth] = useState<number | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lastPreviewWidthRef = useRef(500)
  const navigatorOpenRef = useRef(navigatorOpen)
  const navigatorWidthRef = useRef(navigatorWidth)
  const releasePreviewFrameRef = useRef<number | null>(null)
  const navigationRequestRef = useRef(0)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const [revealingDirectory, setRevealingDirectory] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewDescriptor, setPreviewDescriptor] = useState<FileDescriptor | undefined>()
  const [target, setTarget] = useState<{ hash: string } | undefined>()
  const { entries, loadDirectory, revealDirectory, revealFile, root } = useWorkspaceExplorer(
    resourceId,
    active
  )
  const { decorations: gitDecorations } = useGitDecorations(resourceId, root, { active })

  const showFile = useCallback((path: string, hash?: string, descriptor?: FileDescriptor): void => {
    setMarkdownMode('preview')
    setTarget(hash ? { hash } : undefined)
    setRevealPath(path)
    setRevealingDirectory(false)
    setPreviewPath(path)
    setPreviewDescriptor(descriptor)
  }, [])

  const revealWorkspaceDirectory = useCallback(
    (path: string): void => {
      const request = ++navigationRequestRef.current
      void revealDirectory(path)
        .then((resolved) => {
          if (!resolved || request !== navigationRequestRef.current) return
          setTarget(undefined)
          setPreviewPath(null)
          setPreviewDescriptor(undefined)
          setRevealPath(resolved)
          setRevealingDirectory(true)
        })
        .catch((error) => console.error('[workspace:navigate-directory]', error))
    },
    [revealDirectory]
  )

  const openInBrowser = useCallback(
    (url: string, errorContext: string): void => {
      const request = ++navigationRequestRef.current
      void window.bridge
        .invoke('resource:create', 'browser', sessionId, { url })
        .then((browserResourceId) => {
          if (request !== navigationRequestRef.current) {
            void window.bridge
              .invoke('resource:close', browserResourceId)
              .catch((error) => console.error('[workspace:close-browser]', error))
            return
          }
          window.dispatchEvent(
            new CustomEvent('larify:workbench-select-resource', {
              detail: { rendererId: 'browser', resourceId: browserResourceId, sessionId }
            })
          )
        })
        .catch((error) => console.error(errorContext, error))
    },
    [sessionId]
  )

  const routeFile = useCallback(
    (path: string, hash: string | undefined, request: number, errorContext: string): void => {
      void workspaceClient.inspectFile(resourceId, path).then(
        (file) => {
          if (request !== navigationRequestRef.current) return
          if (opensInBrowser(file)) openInBrowser(file.path, errorContext)
          else showFile(file.path, hash, file)
        },
        (error) => {
          if (request !== navigationRequestRef.current) return
          console.error(errorContext, error)
          showFile(path, hash)
        }
      )
    },
    [openInBrowser, resourceId, showFile]
  )

  const selectFile = useCallback(
    (path: string, hash?: string): void => {
      const request = ++navigationRequestRef.current
      routeFile(path, hash, request, '[workspace:open-file]')
    },
    [routeFile]
  )

  const revealWorkspaceFile = useCallback(
    (path: string, hash: string | undefined, errorContext: string): void => {
      const request = ++navigationRequestRef.current
      void revealFile(path)
        .then((resolved) => {
          if (!resolved || request !== navigationRequestRef.current) return
          routeFile(resolved, hash, request, errorContext)
        })
        .catch((error) => console.error(errorContext, error))
    },
    [revealFile, routeFile]
  )

  useEffect(
    () => () => {
      navigationRequestRef.current += 1
    },
    [resourceId, sessionId]
  )

  useEffect(() => {
    navigatorOpenRef.current = navigatorOpen
    navigatorWidthRef.current = navigatorWidth
  }, [navigatorOpen, navigatorWidth])

  useEffect(() => {
    const updateAnimation = (event: Event): void => {
      if (!(activationStore?.getSnapshot() ?? active)) return
      const { animating, visible } = (event as CustomEvent<WorkbenchAnimationState>).detail
      if (animating) {
        if (releasePreviewFrameRef.current !== null) {
          cancelAnimationFrame(releasePreviewFrameRef.current)
          releasePreviewFrameRef.current = null
        }
        if (!visible) {
          const measuredWidth = previewRef.current?.getBoundingClientRect().width ?? 0
          if (measuredWidth > 0) lastPreviewWidthRef.current = measuredWidth
        }
        setLockedPreviewWidth(lastPreviewWidthRef.current)
      } else if (visible) {
        let remainingFrames = 2
        const releaseAtFinalWidth = (): void => {
          const preview = previewRef.current
          const pane = preview?.closest<HTMLElement>('.split-view-view')
          const requiredWidth =
            lastPreviewWidthRef.current + (navigatorOpenRef.current ? navigatorWidthRef.current : 0)
          if (
            pane &&
            pane.getBoundingClientRect().width + 1 < requiredWidth &&
            remainingFrames-- > 0
          ) {
            releasePreviewFrameRef.current = requestAnimationFrame(releaseAtFinalWidth)
            return
          }
          releasePreviewFrameRef.current = null
          setLockedPreviewWidth(null)
        }
        releaseAtFinalWidth()
      } else {
        setLockedPreviewWidth(null)
      }
      setWorkbenchAnimating(animating)
      setWorkbenchVisible(visible)
    }
    window.addEventListener(workbenchAnimationEvent, updateAnimation)
    window.dispatchEvent(new Event(workbenchStateRequestEvent))
    return () => {
      if (releasePreviewFrameRef.current !== null) {
        cancelAnimationFrame(releasePreviewFrameRef.current)
      }
      window.removeEventListener(workbenchAnimationEvent, updateAnimation)
    }
  }, [activationStore, active])

  useEffect(() => {
    if (!activationStore) return
    const syncVisibility = (): void => {
      if (activationStore.getSnapshot()) {
        window.dispatchEvent(new Event(workbenchStateRequestEvent))
      }
    }
    return activationStore.subscribe(syncVisibility)
  }, [activationStore])

  useEffect(() => {
    updateTab({
      title: previewPath?.split(/[\\/]/).at(-1) ?? '文件',
      tooltip: previewPath ?? '文件'
    })
  }, [previewPath, updateTab])

  useEffect(() => {
    const openFile = (event: Event): void => {
      const {
        hash,
        path,
        resourceId: sourceResourceId
      } = (event as CustomEvent<{ hash?: string; path: string; resourceId: number }>).detail
      if (sourceResourceId !== resourceId) return
      revealWorkspaceFile(path, hash, '[workspace:open-markdown-link]')
    }
    const openExternal = (event: Event): void => {
      const { resourceId: sourceResourceId, url } = (
        event as CustomEvent<{ resourceId: number; url: string }>
      ).detail
      if (sourceResourceId !== resourceId) return
      openInBrowser(url, '[workspace:open-markdown-external]')
    }

    window.addEventListener(workspaceMarkdownOpenFileEvent, openFile)
    window.addEventListener(workspaceMarkdownOpenExternalEvent, openExternal)
    return () => {
      window.removeEventListener(workspaceMarkdownOpenFileEvent, openFile)
      window.removeEventListener(workspaceMarkdownOpenExternalEvent, openExternal)
    }
  }, [openInBrowser, resourceId, revealWorkspaceFile])

  // 消息正文中的文件链接：工作区资源打开后定位到目标文件。
  useEffect(() => {
    const navigate = (request: WorkspaceNavigationRequest): void => {
      if (request.kind === 'directory') revealWorkspaceDirectory(request.path)
      else revealWorkspaceFile(request.path, request.hash, '[workspace:navigate]')
    }
    const onNavigate = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceNavigationRequest>).detail
      if (detail.resourceId !== resourceId) return
      navigate(takeWorkspaceNavigation(resourceId) ?? detail)
    }
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, onNavigate)
    const pending = takeWorkspaceNavigation(resourceId)
    if (pending) navigate(pending)
    return () => window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, onNavigate)
  }, [resourceId, revealWorkspaceDirectory, revealWorkspaceFile])

  useEffect(() => {
    const preload = (): void => {
      void Promise.all([loadFilePreview(), import('./preview/monaco-preview')]).catch(
        () => undefined
      )
    }
    if (typeof requestIdleCallback === 'function') {
      const idle = requestIdleCallback(preload, { timeout: 2_000 })
      return () => cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(preload, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const treeEntries = useMemo(
    () =>
      root ? createPathChangeTree(root, []).map((entry) => ({ ...entry, children: entries })) : [],
    [entries, root]
  )

  const tabActions = useMemo(
    () => (
      <WorkspaceTabActions
        file={previewPath}
        markdownMode={markdownMode}
        navigatorOpen={navigatorOpen}
        onMarkdownModeChange={setMarkdownMode}
        onOpenInBrowser={() => {
          if (previewPath) openInBrowser(previewPath, '[workspace:open-in-browser]')
        }}
        onToggleNavigator={() => setNavigatorOpen((open) => !open)}
      />
    ),
    [markdownMode, navigatorOpen, openInBrowser, previewPath]
  )
  useWorkbenchTabActions(tabActions)

  if (!root) return <EmptyFilePreview />

  return (
    <WorkspaceLayout
      animating={workbenchAnimating}
      navigatorOpen={navigatorOpen}
      onNavigatorWidthChange={setNavigatorWidth}
      visible={workbenchVisible}
      navigator={
        <WorkspaceTree
          key={root}
          changesOnly={false}
          entries={treeEntries}
          gitDecorations={gitDecorations}
          revealPath={revealPath}
          revealDirectory={revealingDirectory}
          onOpen={selectFile}
          onToggle={loadDirectory}
        />
      }
    >
      <div
        className="flex h-full w-full min-h-0 flex-col"
        data-preview-animating={workbenchAnimating || undefined}
        ref={previewRef}
        style={lockedPreviewWidth === null ? undefined : { width: lockedPreviewWidth }}
      >
        {previewPath ? (
          <Suspense fallback={null}>
            <ActivatedFilePreview
              animating={workbenchAnimating}
              descriptor={previewDescriptor}
              enabled={workbenchVisible || workbenchAnimating}
              key={`${resourceId}:${previewPath}`}
              mode={isMarkdownPath(previewPath) ? markdownMode : undefined}
              resourceId={resourceId}
              target={target}
              path={previewPath}
            />
          </Suspense>
        ) : (
          <EmptyFilePreview />
        )}
      </div>
    </WorkspaceLayout>
  )
}

function WorkspaceTabActions({
  file,
  markdownMode,
  navigatorOpen,
  onMarkdownModeChange,
  onOpenInBrowser,
  onToggleNavigator
}: {
  file: string | null
  markdownMode: 'preview' | 'source'
  navigatorOpen: boolean
  onMarkdownModeChange(mode: 'preview' | 'source'): void
  onOpenInBrowser(): void
  onToggleNavigator(): void
}): React.JSX.Element {
  const markdown = file ? isMarkdownPath(file) : false
  const html = file ? /\.html?$/i.test(file) : false

  return (
    <>
      {markdown ? (
        <Button
          aria-label={markdownMode === 'preview' ? '查看源码' : '阅读预览'}
          title={markdownMode === 'preview' ? '查看源码' : '阅读预览'}
          variant="ghost"
          size="icon"
          onClick={() => onMarkdownModeChange(markdownMode === 'preview' ? 'source' : 'preview')}
        >
          {markdownMode === 'preview' ? (
            <Code2Icon aria-hidden className="size-[18px]" />
          ) : (
            <EyeIcon aria-hidden className="size-[18px]" />
          )}
        </Button>
      ) : html ? (
        <Button
          aria-label="在内置浏览器中打开"
          title="在内置浏览器中打开"
          variant="ghost"
          size="icon"
          onClick={onOpenInBrowser}
        >
          <ExternalLinkIcon aria-hidden className="size-[18px]" />
        </Button>
      ) : null}
      <Button
        data-workspace-navigator-toggle
        aria-label={navigatorOpen ? '隐藏目录树' : '显示目录树'}
        title={navigatorOpen ? '隐藏目录树' : '显示目录树'}
        variant={navigatorOpen ? 'secondary' : 'ghost'}
        size="icon"
        onClick={onToggleNavigator}
      >
        <FilesIcon className="size-[17px]" />
      </Button>
    </>
  )
}
