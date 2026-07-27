import { initialize } from '@codingame/monaco-vscode-api'
import {
  getService,
  IEditorGroupsService,
  IEditorService,
  ILanguageService,
  IModelService,
  IWorkbenchThemeService
} from '@codingame/monaco-vscode-api/services'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { getSingleFolderWorkspaceIdentifier } from '@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaceIdentifier'
import getConfigurationServiceOverride, {
  reinitializeWorkspace
} from '@codingame/monaco-vscode-configuration-service-override'
import getFileServiceOverride, {
  registerFileSystemOverlay
} from '@codingame/monaco-vscode-files-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getTextMateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override'
import { whenReady as whenCssReady } from '@codingame/monaco-vscode-css-default-extension'
import { whenReady as whenHtmlReady } from '@codingame/monaco-vscode-html-default-extension'
import { whenReady as whenJsonReady } from '@codingame/monaco-vscode-json-default-extension'
import { whenReady as whenMarkdownReady } from '@codingame/monaco-vscode-markdown-basics-default-extension'
import { whenReady as whenTypeScriptReady } from '@codingame/monaco-vscode-typescript-basics-default-extension'
import * as monaco from 'monaco-editor'
import { WorkspaceFileSystemProvider } from './file-system-provider'
import { languageIdForFile } from './language-associations'
import { whenWorkspaceThemesReady } from './theme-extension'
import { configureEditorWorkers } from './workers'

const workspaceGlobal = globalThis as typeof globalThis & {
  workspaceEditorReady?: Promise<void>
}

configureEditorWorkers()

async function applyFileIconTheme(themeService: IWorkbenchThemeService): Promise<void> {
  const theme = (await themeService.getFileIconThemes()).find(
    (candidate) => candidate.settingsId === 'ide-icons'
  )
  if (theme) await themeService.setFileIconTheme(theme, 'preview')
}

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
        'breadcrumbs.enabled': true,
        'breadcrumbs.icons': false,
        'breadcrumbs.symbolPath': 'off',
        'editor.minimap.enabled': false,
        'editor.scrollbar.horizontalScrollbarSize': 12,
        'editor.scrollbar.verticalScrollbarSize': 12,
        'window.menuBarVisibility': 'hidden',
        'workbench.editor.enablePreview': false,
        'workbench.editor.showIcons': true,
        'workbench.iconTheme': 'ide-icons',
        'workbench.startupEditor': 'none'
      }
    }
  )
})()

export const monacoReady = workspaceGlobal.workspaceEditorReady.then(async () => {
  const [editorGroupsService, themeService] = await Promise.all([
    getService(IEditorGroupsService),
    getService(IWorkbenchThemeService),
    whenWorkspaceThemesReady(),
    whenCssReady(),
    whenHtmlReady(),
    whenJsonReady(),
    whenMarkdownReady(),
    whenTypeScriptReady()
  ])
  await Promise.all([editorGroupsService.whenReady, applyFileIconTheme(themeService)])
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
  const resource = URI.file(file)
  const [editorService, languageService, modelService] = await Promise.all([
    getService(IEditorService),
    getService(ILanguageService),
    getService(IModelService)
  ])
  await editorService.openEditor({ resource, options: { pinned: true } })
  const language =
    languageIdForFile(file) ?? languageService.guessLanguageIdByFilepathOrFirstLine(resource)
  const model = modelService.getModel(resource)
  if (model && language && model.getLanguageId() !== language) {
    monaco.editor.setModelLanguage(model, language)
  }
}

export async function setWorkspaceRoot(root: string): Promise<void> {
  await monacoReady
  const editorGroupsService = await getService(IEditorGroupsService)
  for (const group of editorGroupsService.groups) {
    if (!(await group.closeAllEditors())) {
      throw new Error('Workspace switch was cancelled because an editor could not be closed')
    }
  }
  await reinitializeWorkspace(getSingleFolderWorkspaceIdentifier(URI.file(root)))
  const themeService = await getService(IWorkbenchThemeService)
  await applyFileIconTheme(themeService)
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

export async function observeActiveWorkspaceFile(
  onChange: (file: string | null) => void
): Promise<() => void> {
  await monacoReady
  const editorService = await getService(IEditorService)
  const emit = (): void => onChange(editorService.activeEditor?.resource?.fsPath ?? null)
  const listener = editorService.onDidActiveEditorChange(emit)
  emit()
  return () => listener.dispose()
}

export async function setWorkspaceTheme(theme: 'dark' | 'light'): Promise<void> {
  await monacoReady
  const themeService = await getService(IWorkbenchThemeService)
  const settingsId = theme === 'dark' ? 'IDE Dark' : 'IDE Light'
  let colorTheme
  for (let attempt = 0; attempt < 20 && !colorTheme; attempt += 1) {
    colorTheme = (await themeService.getColorThemes()).find(
      (candidate) => candidate.settingsId === settingsId
    )
    if (!colorTheme) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!colorTheme) return
  await Promise.all([
    themeService.setColorTheme(colorTheme, 'preview'),
    applyFileIconTheme(themeService)
  ])
}
