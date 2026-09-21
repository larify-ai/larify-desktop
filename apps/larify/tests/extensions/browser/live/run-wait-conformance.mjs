import { build } from "esbuild"
import electron from "electron"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const outputDir = await mkdtemp(join(tmpdir(), "larify-wait-conformance-live-"))
const output = join(outputDir, "wait-conformance.cjs")
try {
  await build({
    entryPoints: [join(currentDir, "wait-change-conformance.integration.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    alias: { "@shared": join(currentDir, "../../../../src/shared") },
    external: ["electron"],
    logLevel: "silent"
  })
  const child = spawn(electron, [output], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" }
  })
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (exitCode) => resolve(exitCode ?? 1))
  })
  if (code !== 0) process.exitCode = code
} finally {
  await rm(outputDir, { recursive: true, force: true })
}
