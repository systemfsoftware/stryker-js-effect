/// <reference types="vitest/importMeta" />
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import * as S from 'effect/Schema'

export type StrykerNamespace = '__stryker__' | '__stryker2__'

export type TestRunnerPhase = 'capabilities' | 'init' | 'dryRun' | 'mutantRun' | 'dispose'

export const VitestRunnerPool = S.Literal('threads')
export type VitestRunnerPool = typeof VitestRunnerPool.Type

export const VitestRunnerOptionsSchema = S.Struct({
  dir: S.optional(S.String),
  related: S.Boolean.pipe(S.withDecodingDefaultKey(Effect.succeed(true))),
  configFile: S.optional(S.String),
  pool: S.optional(VitestRunnerPool),
  timeoutTrapFile: S.optional(S.String),
  timeoutTrapMutantId: S.optional(Mutant.MutantId),
})

export type VitestRunnerOptions = S.Schema.Type<typeof VitestRunnerOptionsSchema>

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

const accepts = { pool: S.is(VitestRunnerPool) }

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = ['', 'threads', 'forks', 'vmThreads']
  const isThreadsPool = (pool: string): boolean => pool === 'threads'

  it.prop(
    '∀p_RunnerPoolRefusal_≡ThreadsOnly',
    { of: [S.String], subject: accepts },
    (subject, [drawn]) => Arr.every(Arr.append(seeds, drawn), (pool) => subject.pool(pool) === isThreadsPool(pool)),
  )
}
