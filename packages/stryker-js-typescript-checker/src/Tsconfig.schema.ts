/**
 * Tsconfig — declarations and codecs for the TypeScript configuration consumed by the checker.
 *
 * Typed by Effect Schema and decoded at the boundary; the compiler capability
 * consumes only validated shapes. The JSONC text codec keeps every field the
 * TypeScript API reads back, because the checker hands those documents to the
 * API's own config parser.
 */
import { parse } from '@std/jsonc'
import { Effect, Option, Result, Schema as S, SchemaIssue, SchemaTransformation } from 'effect'

export class TsConfigParseError extends S.TaggedError<TsConfigParseError>()('TsConfigParseError', {
  file: S.String,
  reason: S.String,
}) {}

export class TsConfigNotFoundError extends S.TaggedError<TsConfigNotFoundError>()(
  'TsConfigNotFoundError',
  {
    file: S.String,
  },
) {
  override get message(): string {
    return `The tsconfig file does not exist at: "${this.file}". Please configure the tsconfig file in your stryker.conf file using "tsconfigFile"`
  }
}

export const PathAliasesSchema = S.Record(S.String, S.Array(S.String))

export const TsConfigCompilerOptionsSchema = S.Record(S.String, S.Unknown)

export type TsConfigCompilerOptions = S.Schema.Type<typeof TsConfigCompilerOptionsSchema>

const InternalTsConfigSchema = S.Struct({
  references: S.optional(S.Array(S.Struct({ path: S.String }))),
  compilerOptions: S.optional(TsConfigCompilerOptionsSchema),
})

export const TsConfigSchema = InternalTsConfigSchema

export type TsConfig = S.Schema.Type<typeof TsConfigSchema>

export const TsConfigDocumentSchema = S.Record(S.String, S.Unknown)

export type TsConfigDocument = S.Schema.Type<typeof TsConfigDocumentSchema>

type JsonValue = S.Schema.Type<typeof S.Json>

const reasonOfThrown = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : 'a non-Error value was thrown'

const documentIssueOf = (value: JsonValue): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue({
    message: Result.match(S.decodeUnknownResult(TsConfigSchema)(value), {
      onFailure: (error) => error.message,
      onSuccess: () => 'expected a TypeScript configuration object',
    }),
  })

const parseJsonc = (jsonText: string): Result.Result<JsonValue, SchemaIssue.Issue> =>
  Result.match(
    Result.try({ try: () => parse(jsonText.replace(/^\uFEFF/, '')), catch: (cause) => cause }),
    {
      onFailure: (cause) => Result.fail(new SchemaIssue.InvalidValue({ message: reasonOfThrown(cause) })),
      onSuccess: (value) =>
        Result.mapError(
          S.decodeUnknownResult(S.Json)(value),
          (error) => new SchemaIssue.InvalidValue({ message: error.message }),
        ),
    },
  )

const documentOf = (value: JsonValue): Result.Result<TsConfigDocument, SchemaIssue.Issue> =>
  Option.match(Option.liftPredicate(value, S.is(TsConfigSchema)), {
    onNone: () => Result.fail(documentIssueOf(value)),
    onSome: () =>
      Result.mapError(
        S.decodeUnknownResult(TsConfigDocumentSchema)(value),
        (error) => new SchemaIssue.InvalidValue({ message: error.message }),
      ),
  })

const decodeText = (jsonText: string): Result.Result<TsConfigDocument, SchemaIssue.Issue> =>
  Result.flatMap(parseJsonc(jsonText), documentOf)

export const TsConfigText = S.String.pipe(
  S.decodeTo(
    TsConfigDocumentSchema,
    SchemaTransformation.transformEffect({
      decode: (jsonText: string) =>
        Result.match(decodeText(jsonText), {
          onFailure: (issue) => Effect.fail(issue),
          onSuccess: (document) => Effect.succeed(document),
        }),
      encode: (document: TsConfigDocument) => Effect.succeed(JSON.stringify(document)),
    }),
  ),
)

export type TsConfigText = typeof TsConfigText.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Boolean, Equal } = await import('effect')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  type JsonObject = { readonly [key: string]: JsonValue }
  type JsonDocument = { readonly [key: string]: JsonValue | undefined }

  const ScalarSchema = S.Union([S.String, S.Boolean, S.Int, S.Null])

  const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null

  const parsedOf = (text: string): Option.Option<JsonValue> =>
    Result.match(S.decodeUnknownResult(S.Json)(JSON.parse(text)), {
      onFailure: () => Option.none<JsonValue>(),
      onSuccess: (value) => Option.some(value),
    })

  const accepted = (result: Result.Result<TsConfigDocument, SchemaIssue.Issue>): boolean => Result.isSuccess(result)

  const refusedWithReason = (result: Result.Result<TsConfigDocument, SchemaIssue.Issue>): boolean =>
    Result.match(result, {
      onFailure: (issue) => SchemaIssue.makeFormatterDefault()(issue).length > 0,
      onSuccess: () => false,
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
      (value) =>
        Option.exists(Option.liftPredicate(value, Array.isArray), (entries) => entries.every(isReferenceEntry)),
    )

  const compilerOptionsAccepted = (text: string): boolean =>
    Option.exists(fieldOf(text, 'compilerOptions'), isJsonObject)

  const truncatedTextOf = (text: string): string => text.slice(0, Math.max(1, Math.floor(text.length / 2)))

  const authoredDocument = () =>
    Arbitrary.schema(
      S.Struct({
        extends: S.optional(S.String),
        include: S.String.pipe(S.Array, S.optional),
        files: S.String.pipe(S.Array, S.optional),
        references: S.Struct({ path: S.String }).pipe(S.Array, S.optional),
        compilerOptions: S.optional(S.Record(S.String, ScalarSchema)),
      }),
    ).pipe(
      Arbitrary.map((generated): JsonDocument =>
        Object.fromEntries(Object.entries(generated).filter(([, value]) => value !== undefined))
      ),
    )

  const nonObjectRootText = () => Arbitrary.schema(ScalarSchema).pipe(Arbitrary.map((value) => JSON.stringify(value)))

  const malformedReferencesDocument = () =>
    Arbitrary.schema(S.Union([S.String, S.Int, S.String.pipe(S.Array), S.Struct({ project: S.String })]))
      .pipe(Arbitrary.map((references) => ({ references })))

  const malformedCompilerOptionsDocument = () =>
    Arbitrary.schema(S.Union([S.String, S.Int, S.Boolean, S.Null]))
      .pipe(Arbitrary.map((compilerOptions) => ({ compilerOptions })))

  it.prop(
    '∀tsconfigText_Decode_≡StandardParserOfAuthoredDocument',
    { of: [authoredDocument()], subject: decodeText },
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
    { of: [authoredDocument()], subject: decodeText },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Result.match(subject(`\uFEFF${text}`), {
        onFailure: () => false,
        onSuccess: (decoded) => Equal.equals(decoded, JSON.parse(text)),
      })
    },
  )

  it.prop(
    '∀tsconfigText_TruncatedText_⊥DecodesWithReason',
    { of: [authoredDocument()], subject: decodeText },
    (subject, [document]) => refusedWithReason(subject(truncatedTextOf(JSON.stringify(document)))),
  )

  it.prop(
    '∀tsconfigText_NonObjectRoot_⊥DecodesWhereverReferenceRejectsRoot',
    { of: [nonObjectRootText()], subject: decodeText },
    (subject, [text]) =>
      Boolean.match(rootIsObject(text), {
        onTrue: () => accepted(subject(text)),
        onFalse: () => refusedWithReason(subject(text)),
      }),
  )

  it.prop(
    '∀tsconfigText_MalformedReferences_⊥DecodesWhereverReferenceRejects',
    { of: [malformedReferencesDocument()], subject: decodeText },
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
    { of: [malformedCompilerOptionsDocument()], subject: decodeText },
    (subject, [document]) => {
      const text = JSON.stringify(document)
      return Boolean.match(compilerOptionsAccepted(text), {
        onTrue: () => accepted(subject(text)),
        onFalse: () => refusedWithReason(subject(text)),
      })
    },
  )
}
