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
