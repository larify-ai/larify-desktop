import { homedir } from 'node:os'
import { join } from 'node:path'

export const EMBEDDING_MODEL = 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
export const EMBEDDING_DIMENSIONS = 1024
export const RETRIEVAL_TASK =
  'Given a web search query, retrieve relevant passages that answer the query'

const MODEL_SCOPE = 'https://modelscope.cn/models'
const MODEL_SCOPE_PATH = '{model}/resolve/master'
const MAX_LENGTH = 1024

interface TensorLike {
  tolist(): unknown
}

interface TokenizerLike {
  encode(text: string): number[]
}

interface ExtractOptions {
  pooling: 'last_token'
  normalize: true
  truncation: true
  max_length: number
}

export interface EmbeddingExtractor {
  (input: string, options: ExtractOptions): Promise<TensorLike>
  tokenizer?: TokenizerLike
}

export type EmbeddingExtractorLoader = () => Promise<EmbeddingExtractor>

export interface EmbeddingServiceOptions {
  cacheDir?: string
  loadExtractor?: EmbeddingExtractorLoader
}

export class EmbeddingService {
  private readonly loadExtractor: EmbeddingExtractorLoader
  private extractor?: Promise<EmbeddingExtractor>
  private queue: Promise<void> = Promise.resolve()

  constructor(options: EmbeddingServiceOptions = {}) {
    this.loadExtractor =
      options.loadExtractor ?? (() => loadQwenExtractor(options.cacheDir ?? defaultCacheDir()))
  }

  embedQuery(query: string): Promise<number[]> {
    return this.enqueue(() => this.extract(formatQuery(query)))
  }

  embedDocuments(documents: string[]): Promise<number[][]> {
    if (!documents.length) return Promise.resolve([])
    return this.enqueue(async () => {
      const vectors: number[][] = []
      for (const document of documents) {
        vectors.push(await this.extract(document))
      }
      return vectors
    })
  }

  async tokenCounter(): Promise<(text: string) => number> {
    const tokenizer = (await this.getExtractor()).tokenizer
    if (!tokenizer) throw new Error('Embedding model tokenizer is unavailable.')
    return (text) => tokenizer.encode(text).length
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async extract(input: string): Promise<number[]> {
    const extractor = await this.getExtractor()
    const tensor = await extractor(input, {
      pooling: 'last_token',
      normalize: true,
      truncation: true,
      max_length: MAX_LENGTH
    })
    const output = tensor.tolist()
    const vector = Array.isArray(output) ? output[0] : undefined
    if (!isVector(vector)) {
      throw new Error('Embedding model returned invalid vectors.')
    }
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding model must return ${EMBEDDING_DIMENSIONS} dimensions.`)
    }
    return vector
  }

  private async getExtractor(): Promise<EmbeddingExtractor> {
    try {
      return await (this.extractor ??= this.loadExtractor())
    } catch (error) {
      this.extractor = undefined
      throw error
    }
  }
}

export function formatQuery(query: string): string {
  return `Instruct: ${RETRIEVAL_TASK}\nQuery:${query}`
}

async function loadQwenExtractor(cacheDir: string): Promise<EmbeddingExtractor> {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.allowRemoteModels = true
  env.remoteHost = MODEL_SCOPE
  env.remotePathTemplate = MODEL_SCOPE_PATH
  env.cacheDir = cacheDir

  return (await pipeline('feature-extraction', EMBEDDING_MODEL, {
    dtype: 'q8'
  })) as unknown as EmbeddingExtractor
}

function defaultCacheDir(): string {
  return join(homedir(), '.larify', 'models')
}

function isVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number')
}
