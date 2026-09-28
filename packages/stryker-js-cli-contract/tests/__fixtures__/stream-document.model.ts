import * as JsonSchema from 'effect/JsonSchema'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as Representation from 'effect/SchemaRepresentation'

export type DocumentCodec = S.Codec<S.Json, S.Json>

export interface DocumentReader {
  readonly codec: DocumentCodec
  readonly readingOf: (line: string) => Option.Option<S.Json>
}

const isJsonObject = (node: S.Json): node is S.JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node)

const closedNode = (node: S.Json): S.Json => {
  if (isJsonObject(node)) return closedToDeclaredFields(node)
  if (Array.isArray(node)) return node.map(closedNode)
  return node
}

const closedToDeclaredFields = (node: S.JsonObject): S.JsonObject =>
  Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, key === 'additionalProperties' ? false : closedNode(value)]),
  )

export const documentReaderOf = (draft07Document: S.JsonObject): DocumentReader => {
  const codec = S.make<DocumentCodec>(
    Representation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft07(closedToDeclaredFields(draft07Document)), {
      patterns: 'apply',
    }).ast,
  )
  return {
    codec,
    readingOf: (line) =>
      S.decodeOption(S.fromJsonString(codec))(line).pipe(
        Option.flatMap(S.encodeOption(codec)),
      ),
  }
}
