import { build } from 'esbuild'
import electron from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const outputDir = await mkdtemp(join(tmpdir(), 'larify-recorder-live-'))
const entry = join(outputDir, 'recorder-framerate.cjs')
const recording = join(outputDir, 'recorder-framerate.webm')

try {
  await build({
    entryPoints: [join(currentDir, 'recorder-framerate-main.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    logLevel: 'silent'
  })
  const child = spawn(electron, [entry, recording], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode) => resolve(exitCode ?? 1))
  })
  if (code !== 0) process.exitCode = code
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
