import {
  registerExtension,
  type IExtensionManifest,
  type RegisterLocalExtensionResult
} from '@codingame/monaco-vscode-api/extensions'
import darkModernUrl from '@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_modern.json?url'
import lightModernUrl from '@codingame/monaco-vscode-theme-defaults-default-extension/resources/light_modern.json?url'
import ayuThemeUrl from './assets/ayu-icons/ayu-icons.json?url'

const browserUrl = (url: string): string => new URL(url, globalThis.location.href).href
const ayuIconUrls = import.meta.glob<string>('./assets/ayu-icons/icons/*', {
  eager: true,
  import: 'default',
  query: '?url'
})

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

const ayuExtension = registerExtension(
  {
    name: 'workspace-ayu-icons',
    displayName: 'Workspace Ayu Icons',
    version: '1.0.0',
    publisher: 'workspace',
    engines: { vscode: '*' },
    contributes: {
      iconThemes: [
        {
          id: 'ayu',
          label: 'Ayu',
          path: './ayu-icons.json'
        }
      ]
    }
  },
  undefined,
  { system: true }
) as RegisterLocalExtensionResult
ayuExtension.registerFileUrl('ayu-icons.json', browserUrl(ayuThemeUrl), 'application/json')
for (const [path, url] of Object.entries(ayuIconUrls)) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
  ayuExtension.registerFileUrl(`icons/${name}`, browserUrl(url), mime)
}

export const whenWorkspaceThemesReady = async (): Promise<void> => {
  await Promise.all([extension.whenReady(), ayuExtension.whenReady()])
}
