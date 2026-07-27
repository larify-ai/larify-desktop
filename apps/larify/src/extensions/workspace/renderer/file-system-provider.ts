import {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions
} from '@codingame/monaco-vscode-files-service-override'
import type { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation'
import type {
  IFileReadStreamOptions,
  IFileSystemProviderWithFileReadStreamCapability
} from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import {
  Disposable,
  type IDisposable
} from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import {
  newWriteableStream,
  type ReadableStreamEvents
} from '@codingame/monaco-vscode-api/vscode/vs/base/common/stream'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { workspaceClient } from './workspace-client'

const unsupported = (): never => {
  throw new Error('This workspace operation is not supported yet')
}

const READ_CHUNK_SIZE = 256 * 1024
const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export class WorkspaceFileSystemProvider
  extends Disposable
  implements
    IFileSystemProviderWithFileReadWriteCapability,
    IFileSystemProviderWithFileReadStreamCapability
{
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.FileReadStream
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
    if (!metadata) {
      throw FileSystemProviderError.create(
        resource.fsPath,
        FileSystemProviderErrorCode.FileNotFound
      )
    }
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

  async readFile(resource: URI): Promise<Uint8Array> {
    const content = await workspaceClient.readFile(resource.fsPath)
    if (!content) {
      throw FileSystemProviderError.create(
        resource.fsPath,
        FileSystemProviderErrorCode.FileNotFound
      )
    }
    return content
  }

  readFileStream(
    resource: URI,
    options: IFileReadStreamOptions,
    token: CancellationToken
  ): ReadableStreamEvents<Uint8Array> {
    const stream = newWriteableStream<Uint8Array>(concatChunks, { highWaterMark: 10 })
    void (async () => {
      let handle: number | undefined
      try {
        const metadata = await this.stat(resource)
        if (options.limits?.size !== undefined && metadata.size > options.limits.size) {
          throw FileSystemProviderError.create(
            resource.fsPath,
            FileSystemProviderErrorCode.FileTooLarge
          )
        }
        const openedHandle = await workspaceClient.openFile(resource.fsPath)
        if (openedHandle === null) {
          throw FileSystemProviderError.create(
            resource.fsPath,
            FileSystemProviderErrorCode.FileNotFound
          )
        }
        handle = openedHandle
        let position = options.position ?? 0
        let remaining = options.length ?? Number.POSITIVE_INFINITY
        while (!token.isCancellationRequested && remaining > 0) {
          const length = Math.min(READ_CHUNK_SIZE, remaining)
          const chunk = await workspaceClient.readFileChunk(handle, position, length)
          if (chunk.byteLength === 0) break
          await stream.write(chunk)
          position += chunk.byteLength
          remaining -= chunk.byteLength
        }
        stream.end()
      } catch (error) {
        stream.error(error instanceof Error ? error : new Error(String(error)))
        stream.end()
      } finally {
        if (handle !== undefined) await workspaceClient.closeFile(handle).catch(() => undefined)
      }
    })()
    return stream
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
    return URI.file(path)
  }
}
