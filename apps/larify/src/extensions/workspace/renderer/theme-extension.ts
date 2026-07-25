import {
  registerExtension,
  type IExtensionManifest,
  type RegisterLocalExtensionResult
} from '@codingame/monaco-vscode-api/extensions'
import darkModernUrl from '@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_modern.json?url'
import lightModernUrl from '@codingame/monaco-vscode-theme-defaults-default-extension/resources/light_modern.json?url'
import setiFontUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/seti.woff?url'
import setiThemeUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/vs-seti-icon-theme.json?url'

const browserUrl = (url: string): string => new URL(url, globalThis.location.href).href

const manifest = {
  name: 'workspace-themes',
  displayName: 'Workspace Themes',
  version: '1.0.0',
  publisher: 'workspace',
  engines: { vscode: '*' },
  contributes: {
    themes: [
      {
        id: 'Dark Modern',
        label: 'Dark Modern',
        uiTheme: 'vs-dark',
        path: './themes/dark-modern.json'
      },
      {
        id: 'Light Modern',
        label: 'Light Modern',
        uiTheme: 'vs',
        path: './themes/light-modern.json'
      }
    ]
  }
} satisfies IExtensionManifest

const extension = registerExtension(manifest, undefined, {
  system: true
}) as RegisterLocalExtensionResult
extension.registerFileUrl('themes/dark-modern.json', browserUrl(darkModernUrl), 'application/json')
extension.registerFileUrl('themes/light-modern.json', browserUrl(lightModernUrl), 'application/json')

const setiExtension = registerExtension(
  {
    name: 'workspace-seti-icons',
    displayName: 'Workspace Seti Icons',
    version: '1.0.0',
    publisher: 'workspace',
    engines: { vscode: '*' },
    contributes: {
      iconThemes: [
        {
          id: 'vs-seti',
          label: 'Seti',
          path: './icons/vs-seti-icon-theme.json'
        }
      ]
    }
  },
  undefined,
  { system: true }
) as RegisterLocalExtensionResult
setiExtension.registerFileUrl(
  'icons/vs-seti-icon-theme.json',
  browserUrl(setiThemeUrl),
  'application/json'
)
setiExtension.registerFileUrl('icons/seti.woff', browserUrl(setiFontUrl), 'font/woff')

export const whenWorkspaceThemesReady = async (): Promise<void> => {
  await Promise.all([extension.whenReady(), setiExtension.whenReady()])
}
