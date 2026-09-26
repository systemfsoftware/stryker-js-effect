import * as S from 'effect/Schema'

import { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const SupportedConfigFileExtensions = S.Literals(['ts', 'mts', 'js', 'mjs'])

export const LegacyConfigFileExtensions = S.Literals(['json', 'cjs'])

export const ConfigDocumentSchema = S.Record(S.String, S.Unknown)

export type ConfigDocument = typeof ConfigDocumentSchema.Type

export const ImportedModuleSchema = S.Struct({
  default: S.optional(S.Unknown),
})

export class ReadConfigCommand extends S.TaggedClass<ReadConfigCommand>()('ReadConfigCommand', {
  cliOptions: S.Record(S.String, S.Unknown),
  basePath: S.String,
}) {}

export class MergeCommand extends S.TaggedClass<MergeCommand>()('MergeCommand', {
  base: S.Record(S.String, S.Unknown),
  overrides: S.Record(S.String, S.Unknown),
}) {}

export class MergeResult extends S.TaggedClass<MergeResult>()('MergeResult', {
  merged: S.Record(S.String, S.Unknown),
}) {}

export const ExtendsStepDocumentSchema = S.Struct({
  path: S.String,
  options: ConfigDocumentSchema,
})
export type ExtendsStepDocument = typeof ExtendsStepDocumentSchema.Type

export const ExtendsStepStateSchema = S.Struct({
  visited: S.Array(S.String),
  documents: S.Array(ExtendsStepDocumentSchema),
})
export type ExtendsStepState = typeof ExtendsStepStateSchema.Type

export type ExtendsRefusalReason = 'cycle' | 'non-string-extends'

export const survivorsPriorReport = S.optionalKey(
  S.String.pipe(
    S.annotate({
      description:
        'The path of the prior mutation report a --survivors run admits against and re-tests the survivors of. Defaults to "reports/mutation-report.json" when unset. Deliberately has no default: a default would be injected into every resolved options object and written into every report, poisoning the KTD7 marker that identifies a report produced by a survivors run.',
    }),
  ),
)

export const extendsPropertySchema = S.optionalKey(
  S.String.pipe(
    S.annotate({
      description:
        'Path to another stryker config file whose options merge underneath this one. Resolved relative to this file. A child scalar or array replaces the inherited value; a child object merges one level deep; a child key set to null deletes the inherited key. Inheritance chains are not rewritten, so an inherited relative path value still resolves against the working directory of the run that reads it.',
    }),
  ),
)
export const forkOptionsSchema = S.StructWithRest(
  S.Struct({
    ...Options.StrykerOptionsSchema.schema.fields,
    survivorsPriorReport,
    extends: extendsPropertySchema,
  }),
  [S.Record(S.String, S.Unknown)],
)
