import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  failureCatalogDocumentSource,
  spanTaxonomyDocumentSource,
  stockCatalogDocumentSource,
  streamDocumentSource,
} from './contract-documents.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const write = (relativePath: string, contents: string): void => {
  const target = join(packageRoot, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

write('contract/stream.schema.json', streamDocumentSource())
write('contract/stock-catalog.json', stockCatalogDocumentSource())
write('contract/span-taxonomy.json', spanTaxonomyDocumentSource())
write('contract/failure-catalog.json', failureCatalogDocumentSource())
