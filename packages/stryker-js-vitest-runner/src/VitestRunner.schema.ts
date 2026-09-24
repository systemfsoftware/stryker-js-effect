import { Effect } from 'effect'
import * as S from 'effect/Schema'

import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export type StrykerNamespace = '__stryker__' | '__stryker2__'

export type TestRunnerPhase = 'capabilities' | 'init' | 'dryRun' | 'mutantRun' | 'dispose'

export const VitestRunnerOptionsSchema = S.Struct({
  dir: S.optional(S.String),
  related: S.Boolean.pipe(S.withDecodingDefaultKey(Effect.succeed(true))),
  configFile: S.optional(S.String),
  timeoutTrapFile: S.optional(S.String),
  timeoutTrapMutantId: S.optional(S.String),
})

export type VitestRunnerOptions = S.Schema.Type<typeof VitestRunnerOptionsSchema>
export interface StrykerVitestRunnerOptions {
  vitest: VitestRunnerOptions
}

export interface VitestRunnerOptionsWithStrykerOptions extends StrykerVitestRunnerOptions, Options.StrykerOptions {}

export const HitCountMetaSchema = S.Struct({ hitCount: S.optional(S.Finite) })

export const MutantCoverageMetaSchema = S.Struct({
  mutantCoverage: S.optional(
    S.Struct({
      static: S.Record(S.String, S.Finite),
      perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
    }),
  ),
})

export const MutantCoverageShapeSchema = S.Struct({
  static: S.Record(S.String, S.Finite),
  perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
})

export class CoverageDecodeFailed extends S.TaggedError<CoverageDecodeFailed>()('CoverageDecodeFailed', {
  cause: S.Unknown,
}) {}

export const ExportEntry = S.Union([S.String, S.Record(S.String, S.Unknown)])

export const PackageManifest = S.StructWithRest(
  S.Struct({
    name: S.optional(S.String),
    exports: S.optional(S.Record(S.String, ExportEntry)),
  }),
  [S.Record(S.String, S.Unknown)],
)

export type PackageManifest = S.Schema.Type<typeof PackageManifest>
export type ExportEntry = S.Schema.Type<typeof ExportEntry>
