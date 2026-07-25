import {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileType,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions
} from '@codingame/monaco-vscode-files-service-override'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import {
  Disposable,
  type IDisposable
} from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { Uri } from 'monaco-editor'
import { workspaceClient } from './workspace-client'

const unsupported = (): never => {
  throw new Error('This workspace operation is not supported yet')
}

export class WorkspaceFileSystemProvider
  extends Disposable
  implements IFileSystemProviderWithFileReadWriteCapability
{
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite
  private readonly changeEmitter = this._register(new Emitter<readonly IFileChange[]>())
  private readonly capabilitiesEmitter = this._register(new Emitter<void>())

  readonly onDidChangeCapabilities = this.capabilitiesEmitter.event
  readonly onDidChangeFile = this.changeEmitter.event

  constructor() {
    super()
    const unsubscribe = workspaceClient.onDidChange((event, path) => {
      this.changeEmitter.fire([
        {
          resource: this.uri(path),
          type: this.changeType(event)
        }
      ])
    })
    this._register({ dispose: unsubscribe })
  }

  async stat(resource: URI): Promise<IStat> {
    const metadata = await workspaceClient.stat(resource.fsPath)
    return {
      type: metadata.directory ? FileType.Directory : FileType.File,
      ctime: metadata.ctime,
      mtime: metadata.mtime,
      size: metadata.size
    }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const entries = await workspaceClient.readDirectory(resource.fsPath)
    return entries.map(({ kind, name }) => [
      name,
      kind === 'directory' ? FileType.Directory : FileType.File
    ])
  }

  readFile(resource: URI): Promise<Uint8Array> {
    return workspaceClient.readFile(resource.fsPath)
  }

  writeFile(resource: URI, content: Uint8Array, options: IFileWriteOptions): Promise<void> {
    void options
    return workspaceClient.writeFile(resource.fsPath, content)
  }

  watch(resource: URI, options: IWatchOptions): IDisposable {
    void resource
    void options
    return Disposable.None
  }

  async mkdir(resource: URI): Promise<void> {
    void resource
    unsupported()
  }

  async delete(resource: URI, options: IFileDeleteOptions): Promise<void> {
    void resource
    void options
    unsupported()
  }

  async rename(from: URI, to: URI, options: IFileOverwriteOptions): Promise<void> {
    void from
    void to
    void options
    unsupported()
  }

  private changeType(event: string): FileChangeType {
    if (event === 'add' || event === 'addDir') return FileChangeType.ADDED
    if (event === 'unlink' || event === 'unlinkDir') return FileChangeType.DELETED
    return FileChangeType.UPDATED
  }

  private uri(path: string): URI {
    return Uri.file(path) as URI
  }
}
