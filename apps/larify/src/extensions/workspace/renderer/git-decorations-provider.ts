import { getService, IDecorationsService } from '@codingame/monaco-vscode-api/services'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import type {
  IDecorationData,
  IDecorationsProvider
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/decorations/common/decorations'
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { FileStatusResult } from 'simple-git'
import { gitDecorationColorId } from './git-status'
import { monacoReady } from './monaco'

class GitDecorationsProvider implements IDecorationsProvider {
  readonly label = 'Git'
  private readonly changeEmitter = new Emitter<readonly URI[]>()
  readonly onDidChange = this.changeEmitter.event
  private decorations = new Map<string, IDecorationData>()

  provideDecorations(uri: URI): IDecorationData | undefined {
    return this.decorations.get(uri.toString())
  }

  update(statuses: FileStatusResult[]): void {
    const next = new Map<string, IDecorationData>()
    for (const status of statuses) {
      const color = gitDecorationColorId(status)
      if (!color) continue
      next.set(URI.file(status.path).toString(), {
        bubble: `${status.index}${status.working_dir}` !== '!!',
        color
      })
    }

    const changed = new Set([...this.decorations.keys(), ...next.keys()])
    this.decorations = next
    this.changeEmitter.fire([...changed].map((resource) => URI.parse(resource)))
  }
}

let provider: Promise<{ decoration: GitDecorationsProvider; registration: IDisposable }> | undefined

const getProvider = (): Promise<{
  decoration: GitDecorationsProvider
  registration: IDisposable
}> => {
  provider ??= monacoReady.then(async () => {
    const decoration = new GitDecorationsProvider()
    const service = await getService(IDecorationsService)
    return {
      decoration,
      registration: service.registerDecorationsProvider(decoration)
    }
  })
  return provider
}

export async function updateGitDecorations(statuses: FileStatusResult[]): Promise<void> {
  const { decoration } = await getProvider()
  decoration.update(statuses)
}
