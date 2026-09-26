import { describe } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { ParseTsconfigTextCommand } from '../CheckerCommands.schema.js'
import { parseTsconfigText, TsconfigParsed } from '../parse-tsconfig-text.workflow.js'
import type { TsConfigDocument } from '../Tsconfig.schema.js'

type JsonValue = S.Schema.Type<typeof S.Json>
type JsonObject = { readonly [key: string]: JsonValue }
type JsonDocument = { readonly [key: string]: JsonValue | undefined }

const scalarSchema = () => S.Union([S.String, S.Boolean, S.Int, S.Null])

const decided = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const decodedFor = (jsonText: string): Result.Result<TsConfigDocument, string> => {
  const decision = decided(parseTsconfigText(ParseTsconfigTextCommand.make({ text: jsonText })))
  return S.is(TsconfigParsed)(decision) ? Result.succeed(decision.document) : Result.fail(decision.reason)
}

const accepted = (result: Result.Result<TsConfigDocument, string>): boolean => Result.isSuccess(result)

const refusedWithReason = (result: Result.Result<TsConfigDocument, string>): boolean =>
  Result.match(result, { onFailure: (reason) => reason.length > 0, onSuccess: () => false })

const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null

const parsedOf = (text: string): Option.Option<JsonValue> =>
  Result.match(S.decodeUnknownResult(S.Json)(JSON.parse(text)), {
    onFailure: () => Option.none<JsonValue>(),
    onSuccess: (value) => Option.some(value),
  })

const rootIsObject = (text: string): boolean => Option.exists(parsedOf(text), isJsonObject)

const fieldOf = (text: string, key: string): Option.Option<JsonValue> =>
  Option.flatMap(
    parsedOf(text),
    (document) =>
      Option.flatMap(Option.liftPredicate(document, isJsonObject), (record) => Option.fromNullishOr(record[key])),
  )

const isReferenceEntry = (value: JsonValue): boolean =>
  Option.exists(Option.liftPredicate(value, isJsonObject), (record) => typeof record['path'] === 'string')

const referencesAccepted = (text: string): boolean =>
  Option.exists(
    fieldOf(text, 'references'),
    (value) => Option.exists(Option.liftPredicate(value, Array.isArray), (entries) => entries.every(isReferenceEntry)),
  )

const compilerOptionsAccepted = (text: string): boolean => Option.exists(fieldOf(text, 'compilerOptions'), isJsonObject)

const authoredDocument = (): Arbitrary.Arbitrary<JsonDocument> =>
  Arbitrary.schema(
    S.Struct({
      extends: S.optional(S.String),
      include: S.String.pipe(S.Array, S.optional),
      files: S.String.pipe(S.Array, S.optional),
      references: S.Struct({ path: S.String }).pipe(S.Array, S.optional),
      compilerOptions: S.optional(S.Record(S.String, scalarSchema())),
    }),
  ).pipe(
    Arbitrary.map((generated): JsonDocument =>
      Object.fromEntries(Object.entries(generated).filter(([, value]) => value !== undefined))
    ),
  )

const nonObjectRootText = (): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(scalarSchema()).pipe(Arbitrary.map((value) => JSON.stringify(value)))

const malformedReferencesDocument = (): Arbitrary.Arbitrary<{ readonly references: JsonValue }> =>
  Arbitrary.schema(S.Union([S.String, S.Int, S.String.pipe(S.Array), S.Struct({ project: S.String })])).pipe(
    Arbitrary.map((references): { readonly references: JsonValue } => ({ references })),
  )

const malformedCompilerOptionsDocument = (): Arbitrary.Arbitrary<{ readonly compilerOptions: JsonValue }> =>
  Arbitrary.schema(S.Union([S.String, S.Int, S.Boolean, S.Null])).pipe(
    Arbitrary.map((compilerOptions): { readonly compilerOptions: JsonValue } => ({ compilerOptions })),
  )

const unparseableText = (): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(S.Union([scalarSchema(), S.Record(S.String, scalarSchema())])).pipe(
    Arbitrary.map((value) => `${JSON.stringify(value)}#`),
  )

describe('parseTsconfigText', (it) => {
  it.prop(
    '∀tsconfigText_Decode_≡StandardParserOfAuthoredDocument',
    { of: [authoredDocument()], subject: decodedFor },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Result.match(subject(text), {
        onFailure: () => false,
        onSuccess: (decoded) => Equal.equals(decoded, JSON.parse(text)),
      })
    },
  )

  it.prop(
    '∀tsconfigText_ByteOrderMark_≡StandardParserOfAuthoredDocument',
    { of: [authoredDocument()], subject: decodedFor },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Result.match(subject(`\uFEFF${text}`), {
        onFailure: () => false,
        onSuccess: (decoded) => Equal.equals(decoded, JSON.parse(text)),
      })
    },
  )

  it.prop(
    '∀tsconfigText_NonObjectRoot_⊥DecodesWhereverReferenceRejectsRoot',
    { of: [nonObjectRootText()], subject: decodedFor },
    (subject, [text]) =>
      Boolean.match(rootIsObject(text), {
        onTrue: () => accepted(subject(text)),
        onFalse: () => refusedWithReason(subject(text)),
      }),
  )

  it.prop(
    '∀tsconfigText_MalformedReferences_⊥DecodesWhereverReferenceRejects',
    { of: [malformedReferencesDocument()], subject: decodedFor },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Boolean.match(referencesAccepted(text), {
        onTrue: () => accepted(subject(text)),
        onFalse: () => refusedWithReason(subject(text)),
      })
    },
  )

  it.prop(
    '∀tsconfigText_MalformedCompilerOptions_⊥DecodesWhereverReferenceRejects',
    { of: [malformedCompilerOptionsDocument()], subject: decodedFor },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Boolean.match(compilerOptionsAccepted(text), {
        onTrue: () => accepted(subject(text)),
        onFalse: () => refusedWithReason(subject(text)),
      })
    },
  )

  it.prop(
    '∀tsconfigText_UnparseableText_⊥DecodesWithReason',
    { of: [unparseableText()], subject: decodedFor },
    (subject, [text]) => refusedWithReason(subject(text)),
  )
})
