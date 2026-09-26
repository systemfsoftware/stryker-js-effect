/// <reference types="vitest/importMeta" />
import { Schema as S } from 'effect'

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

const JsonRecord = S.Record(S.String, S.Json)

export const ProjectReferenceSchema = S.StructWithRest(S.Struct({ path: S.String }), [JsonRecord])

export const TsConfigCompilerOptionsSchema = JsonRecord

export type TsConfigCompilerOptions = S.Schema.Type<typeof TsConfigCompilerOptionsSchema>

export const TsConfigDocumentSchema = S.StructWithRest(
  S.Struct({
    references: S.optional(S.Array(ProjectReferenceSchema)),
    compilerOptions: S.optional(TsConfigCompilerOptionsSchema),
  }),
  [JsonRecord],
)

export type TsConfigDocument = S.Schema.Type<typeof TsConfigDocumentSchema>

const accepts = {
  tsConfigDocument: S.is(TsConfigDocumentSchema),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  type JsonValue = S.Schema.Type<typeof S.Json>

  const isJsonObject = S.is(S.Record(S.String, S.Json))
  const isJsonArray = S.is(S.Array(S.Json))
  const isReference = (value: JsonValue): boolean => isJsonObject(value) && typeof value['path'] === 'string'
  const referencesHold = (references: JsonValue): boolean => isJsonArray(references) && references.every(isReference)
  const compilerOptionsHold = (compilerOptions: JsonValue): boolean => isJsonObject(compilerOptions)
  const fieldHolds = (field: JsonValue | undefined, holds: (value: JsonValue) => boolean): boolean =>
    field === undefined || holds(field)
  const isDocument = (value: JsonValue): boolean =>
    isJsonObject(value) &&
    Arr.every([
      fieldHolds(value['references'], referencesHold),
      fieldHolds(value['compilerOptions'], compilerOptionsHold),
    ], (
      holds,
    ) => holds)

  const seeds: ReadonlyArray<JsonValue> = [
    null,
    42,
    'tsconfig',
    [],
    {},
    { references: [] },
    { references: [{}] },
    { references: [{ path: 'p' }] },
    { references: 'x' },
    { compilerOptions: {} },
    { compilerOptions: 'x' },
  ]

  it.prop(
    '∀j_TsConfigDocumentRefusal_≡DeclaredShape',
    { of: [S.Json], subject: accepts },
    (subject, [value]) =>
      Arr.every(Arr.append(seeds, value), (candidate) => subject.tsConfigDocument(candidate) === isDocument(candidate)),
  )
}
