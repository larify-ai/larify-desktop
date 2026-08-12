import iconTheme from '../assets/ide-icons/ide-icon-theme.json'
import iconThemeUrl from '../assets/ide-icons/ide-icon-theme.json?url'

export { iconTheme, iconThemeUrl }

export const iconAssetUrls = import.meta.glob<string>('../assets/ide-icons/**/*', {
  eager: true,
  import: 'default',
  query: '?url'
})

export const iconAssetUrlBySuffix = new Map(
  Object.entries(iconAssetUrls).map(([path, url]) => [
    path.slice(path.indexOf('/assets/ide-icons/')),
    url
  ])
)
