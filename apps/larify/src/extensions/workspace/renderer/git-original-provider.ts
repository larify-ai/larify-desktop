import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat
} from '@codingame/monaco-vscode-files-service-override'
import { Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import {
  Disposable,
  type IDisposable
} from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { workspaceClient } from './workspace-client'

const unavailable = (resource: URI): never => {
  throw FileSystemProviderError.create(
    resource.toString(),
    FileSystemProviderErrorCode.NoPermissions
  )
}

export class GitOriginalFileSystemProvider
  extends Disposable
  implements IFileSystemProviderWithFileReadWriteCapability
{
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite
  readonly onDidChangeCapabilities = Event.None
  readonly onDidChangeFile = Event.None
  private readonly content = new Map<string, Uint8Array>()

  async resolve(file: URI): Promise<URI | null> {
    const content = await workspaceClient.gitOriginal(file.fsPath)
    if (!content) return null
    const original = file.with({ scheme: 'git-original' })
    this.content.set(original.toString(), content)
    return original
  }

  empty(file: URI, side: 'modified' | 'original'): URI {
    const resource = file.with({ scheme: 'git-original', query: `empty=${side}` })
    this.content.set(resource.toString(), new Uint8Array())
    return resource
  }

  async stat(resource: URI): Promise<IStat> {
    const content = this.get(resource)
    return { type: FileType.File, ctime: 0, mtime: 0, size: content.byteLength }
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    return this.get(resource)
  }

  watch(): IDisposable {
    return Disposable.None
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    return unavailable(resource)
  }

  async writeFile(resource: URI, content: Uint8Array, options: IFileWriteOptions): Promise<void> {
    void content
    void options
    return unavailable(resource)
  }

  async mkdir(resource: URI): Promise<void> {
    return unavailable(resource)
  }

  async delete(resource: URI, options: IFileDeleteOptions): Promise<void> {
    void options
    return unavailable(resource)
  }

  async rename(from: URI, to: URI, options: IFileOverwriteOptions): Promise<void> {
    void to
    void options
    return unavailable(from)
  }

  private get(resource: URI): Uint8Array {
    const content = this.content.get(resource.toString())
    if (content) return content
    throw FileSystemProviderError.create(
      resource.toString(),
      FileSystemProviderErrorCode.FileNotFound
    )
  }
}
