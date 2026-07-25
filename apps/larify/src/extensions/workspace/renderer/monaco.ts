import { initialize } from '@codingame/monaco-vscode-api'
import {
  getService,
  IEditorGroupsService,
  IEditorService,
  ILanguageService,
  IModelService,
  IWorkbenchThemeService
} from '@codingame/monaco-vscode-api/services'
import { getIconClasses } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/getIconClasses'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { FileKind } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import getFileServiceOverride, {
  registerFileSystemOverlay
} from '@codingame/monaco-vscode-files-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getTextMateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override'
import '@codingame/monaco-vscode-css-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-json-default-extension'
import '@codingame/monaco-vscode-markdown-basics-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import * as monaco from 'monaco-editor'
import { WorkspaceFileSystemProvider } from './file-system-provider'
import { whenWorkspaceThemesReady } from './theme-extension'
import { configureEditorWorkers } from './workers'

const workspaceGlobal = globalThis as typeof globalThis & {
  workspaceEditorReady?: Promise<void>
}

configureEditorWorkers()

workspaceGlobal.workspaceEditorReady ??= (() => {
  const provider = new WorkspaceFileSystemProvider()
  registerFileSystemOverlay(1, provider)
  return initialize(
    {
      ...getConfigurationServiceOverride(),
      ...getFileServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getModelServiceOverride(),
      ...getTextMateServiceOverride(),
      ...getViewsServiceOverride(),
      ...getThemeServiceOverride()
    },
    undefined,
    {
      configurationDefaults: {
        'breadcrumbs.enabled': false,
        'editor.minimap.enabled': false,
        'window.menuBarVisibility': 'hidden',
        'workbench.iconTheme': 'ayu',
        'workbench.startupEditor': 'none'
      }
    }
  )
})()

export const monacoReady = workspaceGlobal.workspaceEditorReady.then(async () => {
  const [editorGroupsService, themeService] = await Promise.all([
    getService(IEditorGroupsService),
    getService(IWorkbenchThemeService),
    whenWorkspaceThemesReady()
  ])
  await Promise.all([
    editorGroupsService.whenReady,
    themeService.setFileIconTheme('ayu', undefined)
  ])
  await Promise.all(
    editorGroupsService.groups.flatMap((group) =>
      group.editors
        .filter((editor) => editor.resource === undefined)
        .map((editor) => group.closeEditor(editor))
    )
  )
})

export async function openWorkspaceFile(file: string): Promise<void> {
  await monacoReady
  const editorService = await getService(IEditorService)
  await editorService.openEditor({ resource: URI.file(file) })
}

export async function observeWorkspaceEditor(
  onChange: (hasEditor: boolean) => void
): Promise<() => void> {
  await monacoReady
  const editorService = await getService(IEditorService)
  const emit = (): void => onChange(editorService.activeEditor !== undefined)
  const listener = editorService.onDidActiveEditorChange(emit)
  emit()
  return () => listener.dispose()
}

export async function createWorkspaceIconResolver(): Promise<
  (path: string, kind: 'file' | 'folder' | 'root') => string
> {
  await monacoReady
  const [modelService, languageService] = await Promise.all([
    getService(IModelService),
    getService(ILanguageService)
  ])
  return (path, kind) =>
    getIconClasses(
      modelService,
      languageService,
      URI.file(path),
      kind === 'file' ? FileKind.FILE : kind === 'root' ? FileKind.ROOT_FOLDER : FileKind.FOLDER
    ).join(' ')
}

export async function setWorkspaceTheme(theme: 'dark' | 'light'): Promise<void> {
  await Promise.all([monacoReady, whenWorkspaceThemesReady()])
  monaco.editor.setTheme(theme === 'dark' ? 'Dark Modern' : 'Light Modern')
}
