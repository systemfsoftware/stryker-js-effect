import * as JsonSchema from 'effect/JsonSchema'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { RunEvent } from '../src/RunEvent/mod.js'
import { spanMembers } from '../src/SpanTaxonomy.js'
import { SpanDocuments, type SpanMember } from '../src/SpanTaxonomy.schema.js'
import { StockCatalog } from '../src/StockCatalog.js'

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

export const spanDocumentOf = (member: SpanMember) => ({
  id: member.name,
  name: member.name,
  attributes: Object.fromEntries(
    Object.entries(member.attributes).map(([key, schema]) => [key, Schema.toJsonSchemaDocument(schema).schema]),
  ),
})

export const spanTaxonomyDocumentSource = (): string =>
  `${
    JSON.stringify(
      Result.getOrThrowWith(
        Schema.decodeUnknownResult(SpanDocuments)(spanMembers.map(spanDocumentOf)),
        (error) => new Error(`the span taxonomy is not a valid contract document: ${error.message}`),
      ),
      null,
      2,
    )
  }\n`
