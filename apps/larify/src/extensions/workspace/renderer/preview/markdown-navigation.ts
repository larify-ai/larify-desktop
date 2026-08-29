import { decodeUrlComponent, resolveWorkspacePath } from '@renderer/lib/workspace-link'

export { decodeUrlComponent, resolveWorkspacePath }

export function scrollToHash(root: HTMLElement | null, id: string): void {
  const target = [...(root?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(
    (element) => element.id === id
  )
  if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView()
}
