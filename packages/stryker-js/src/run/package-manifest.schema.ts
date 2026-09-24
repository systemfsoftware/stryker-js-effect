import * as S from 'effect/Schema'

export const PackageExport: S.Codec<S.Json> = S.Union([
  S.Null,
  S.String,
  S.Array(S.suspend((): S.Codec<S.Json> => PackageExport)),
  S.Record(S.String, S.suspend((): S.Codec<S.Json> => PackageExport)),
]).annotate({ identifier: 'PackageExport' })
export type PackageExportValue = S.Schema.Type<typeof PackageExport>

export const PackageManifestFields = S.Struct({
  exports: S.optional(PackageExport),
  module: S.optional(S.String),
  main: S.optional(S.String),
})
export type PackageManifestFields = S.Schema.Type<typeof PackageManifestFields>
