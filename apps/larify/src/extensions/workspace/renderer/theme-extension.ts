import {
  registerExtension,
  type IExtensionManifest,
  type RegisterLocalExtensionResult
} from '@codingame/monaco-vscode-api/extensions'
import { iconAssetUrls, iconThemeUrl } from './ide-icon-assets'

const browserUrl = (url: string): string => new URL(url, globalThis.location.href).href
const themeUrls = import.meta.glob<string>('./assets/ide-theme/*.json', {
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
        id: 'IDE Dark',
        label: 'IDE Dark',
        uiTheme: 'vs-dark',
        path: './themes/dark_plus.json'
      },
      {
        id: 'IDE Light',
        label: 'IDE Light',
        uiTheme: 'vs',
        path: './themes/light.json'
      }
    ]
  }
} satisfies IExtensionManifest

const extension = registerExtension(manifest, undefined, {
  system: true
}) as RegisterLocalExtensionResult
for (const [path, url] of Object.entries(themeUrls)) {
  extension.registerFileUrl(
    `themes/${path.slice(path.lastIndexOf('/') + 1)}`,
    browserUrl(url),
    'application/json'
  )
}

const gitColorExtension = registerExtension(
  {
    name: 'workspace-git-colors',
    displayName: 'Workspace Git Colors',
    version: '1.0.0',
    publisher: 'workspace',
    engines: { vscode: '*' },
    contributes: {
      colors: [
        {
          id: 'gitDecoration.addedResourceForeground',
          description: 'Color for added resources.',
          defaults: {
            light: '#587c0c',
            dark: '#81b88b',
            highContrast: '#a1e3ad',
            highContrastLight: '#374e06'
          }
        },
        {
          id: 'gitDecoration.modifiedResourceForeground',
          description: 'Color for modified resources.',
          defaults: {
            light: '#F0A50F',
            dark: '#E2C08D',
            highContrast: '#E2C08D',
            highContrastLight: '#895503'
          }
        },
        {
          id: 'gitDecoration.deletedResourceForeground',
          description: 'Color for deleted resources.',
          defaults: {
            light: '#ad0707',
            dark: '#c74e39',
            highContrast: '#c74e39',
            highContrastLight: '#ad0707'
          }
        },
        {
          id: 'gitDecoration.renamedResourceForeground',
          description: 'Color for renamed or copied resources.',
          defaults: {
            light: '#00AA62',
            dark: '#168A63',
            highContrast: '#168A63',
            highContrastLight: '#007100'
          }
        },
        {
          id: 'gitDecoration.untrackedResourceForeground',
          description: 'Color for untracked resources.',
          defaults: {
            light: '#00AA62',
            dark: '#168A63',
            highContrast: '#168A63',
            highContrastLight: '#007100'
          }
        },
        {
          id: 'gitDecoration.stageModifiedResourceForeground',
          description: 'Color for staged modified resources.',
          defaults: {
            light: '#F0A50F',
            dark: '#E2C08D',
            highContrast: '#E2C08D',
            highContrastLight: '#895503'
          }
        },
        {
          id: 'gitDecoration.stageDeletedResourceForeground',
          description: 'Color for staged deleted resources.',
          defaults: {
            light: '#ad0707',
            dark: '#c74e39',
            highContrast: '#c74e39',
            highContrastLight: '#ad0707'
          }
        },
        {
          id: 'gitDecoration.conflictingResourceForeground',
          description: 'Color for resources with conflicts.',
          defaults: {
            light: '#ad0707',
            dark: '#e4676b',
            highContrast: '#c74e39',
            highContrastLight: '#ad0707'
          }
        }
      ]
    }
  },
  undefined,
  { system: true }
) as RegisterLocalExtensionResult

const iconExtension = registerExtension(
  {
    name: 'workspace-ide-icons',
    displayName: 'Workspace IDE Icons',
    version: '1.0.0',
    publisher: 'workspace',
    engines: { vscode: '*' },
    contributes: {
      iconThemes: [
        {
          id: 'ide-icons',
          label: 'IDE Icons',
          path: './ide-icon-theme.json'
        }
      ]
    }
  },
  undefined,
  { system: true }
) as RegisterLocalExtensionResult
iconExtension.registerFileUrl('ide-icon-theme.json', browserUrl(iconThemeUrl), 'application/json')
for (const [path, url] of Object.entries(iconAssetUrls)) {
  const relativePath = path.slice(path.indexOf('/ide-icons/') + '/ide-icons/'.length)
  if (relativePath === 'ide-icon-theme.json') continue
  const mime = relativePath.endsWith('.svg')
    ? 'image/svg+xml'
    : relativePath.endsWith('.woff')
      ? 'font/woff'
      : 'application/octet-stream'
  iconExtension.registerFileUrl(relativePath, browserUrl(url), mime)
}

export const whenWorkspaceThemesReady = async (): Promise<void> => {
  await Promise.all([
    extension.whenReady(),
    gitColorExtension.whenReady(),
    iconExtension.whenReady()
  ])
}
