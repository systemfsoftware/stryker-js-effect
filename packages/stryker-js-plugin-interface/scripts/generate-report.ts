import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reportDocumentSource, reportModuleSource } from './report-contract.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const write = (relativePath: string, contents: string): void => {
  const target = join(packageRoot, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

write('src/generated/report.schema.ts', reportModuleSource())
write('contract/report.schema.json', reportDocumentSource())
