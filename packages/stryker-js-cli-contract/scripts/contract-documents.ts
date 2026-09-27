import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

import { RunEvent } from '../src/RunEvent/mod.js'
import { StockCatalog } from '../src/StockCatalog.js'

export const GENERATOR = 'scripts/generate-contract.ts'

export const streamDocumentSource = (): string => {
  const draft07 = JsonSchema.toDocumentDraft07(Schema.toJsonSchemaDocument(RunEvent))
  const published = {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07,
    ...draft07.schema,
    definitions: draft07.definitions,
  }
  return `${JSON.stringify(published, null, 2)}\n`
}

export const stockCatalogDocumentSource = (): string => `${JSON.stringify(StockCatalog.entries, null, 2)}\n`
