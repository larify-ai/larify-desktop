import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'

export interface FileDiagnosticsProvider {
  matches(file: string): boolean
  provide(file: string): Promise<PublishDiagnosticsParams>
}

const providers = new Set<FileDiagnosticsProvider>()

export function registerFileDiagnosticsProvider(provider: FileDiagnosticsProvider): () => void {
  providers.add(provider)
  return () => providers.delete(provider)
}

export async function provideFileDiagnostics(file: string): Promise<PublishDiagnosticsParams[]> {
  const results = await Promise.all([...providers].map((provider) => safeProvide(provider, file)))
  return results.filter((result): result is PublishDiagnosticsParams => result !== undefined)
}

async function safeProvide(
  provider: FileDiagnosticsProvider,
  file: string
): Promise<PublishDiagnosticsParams | undefined> {
  try {
    if (!provider.matches(file)) return
    return await provider.provide(file)
  } catch {
    return
  }
}

export function formatFileDiagnostics(results: PublishDiagnosticsParams[] = []): string {
  const diagnostics = results.flatMap((result) => result.diagnostics)
  if (!diagnostics.length) return ''

  const messages = diagnostics.map((diagnostic) => `- ${diagnostic.message}`).join('\n')
  return `\nDiagnostics:\n${messages}`
}
