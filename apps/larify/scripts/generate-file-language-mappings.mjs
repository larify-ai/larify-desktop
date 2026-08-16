/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const extensionsRoot = process.argv[2]
const output = process.argv[3]

if (!extensionsRoot || !output) {
  throw new Error(
    'Usage: node generate-file-language-mappings.mjs <vscode-extensions-dir> <output-json>'
  )
}

const mappings = new Map()
const repositoryRoot = path.dirname(extensionsRoot)
const revision = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
  encoding: 'utf8'
}).trim()

for (const directory of await readdir(extensionsRoot, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue

  const manifestPath = path.join(extensionsRoot, directory.name, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    continue
  }

  for (const language of manifest.contributes?.languages ?? []) {
    // A language id may be contributed by multiple builtin extensions. Combine
    // their path-based associations; firstLine and mimetypes are intentionally
    // excluded because file icons are resolved without reading file contents.
    const mapping = mappings.get(language.id) ?? {
      extensions: new Set(),
      fileNamePatterns: new Set(),
      fileNames: new Set(),
      sources: new Set()
    }
    for (const extension of language.extensions ?? [])
      mapping.extensions.add(extension.toLowerCase())
    for (const pattern of language.filenamePatterns ?? [])
      mapping.fileNamePatterns.add(pattern.toLowerCase())
    for (const fileName of language.filenames ?? []) mapping.fileNames.add(fileName.toLowerCase())
    mapping.sources.add(directory.name)
    mappings.set(language.id, mapping)
  }
}

const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b))
const languages = Object.fromEntries(
  [...mappings.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, mapping]) => [
      id,
      {
        extensions: sorted(mapping.extensions),
        fileNamePatterns: sorted(mapping.fileNamePatterns),
        fileNames: sorted(mapping.fileNames),
        sources: sorted(mapping.sources)
      }
    ])
)

await writeFile(
  output,
  `${JSON.stringify(
    {
      source: {
        repository: 'https://github.com/microsoft/vscode',
        revision
      },
      languages
    },
    null,
    2
  )}\n`,
  'utf8'
)
