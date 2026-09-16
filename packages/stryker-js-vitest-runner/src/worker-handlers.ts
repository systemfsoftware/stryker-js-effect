import {
  type CompleteDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  errorToString,
  MutantCoverageSchema,
  type MutantRunOptions,
  type MutantRunResult,
  TestRunner,
  TestRunnerFailed,
} from '@systemfsoftware/stryker-js-language'
import { decodeWorkerOptions, TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { makeVitestRunnerLayer } from './Runner.js'

declare global {
  var __mutantCoverage__: unknown
}

const isCompleteDryRun = (result: DryRunResult): result is CompleteDryRunResult => result.status === 'complete'

const COVERAGE_SETTLED: readonly ((result: DryRunResult, options: DryRunOptions) => boolean)[] = [
  (result) => result.status !== 'complete',
  (result) =>
    Option.exists(Option.liftPredicate(result, isCompleteDryRun), (complete) => complete.mutantCoverage !== undefined),
  (_result, options) => options.coverageAnalysis === 'off',
]

const coverageNeeded = (result: DryRunResult, options: DryRunOptions): boolean =>
  !COVERAGE_SETTLED.some((settled) => settled(result, options))

const normalizeDryRun = (result: DryRunResult): DryRunResult => {
  if (result.status === 'error') {
    return { ...result, errorMessage: errorToString(result.errorMessage) }
  }
  return result
}

const decodeCoverageInto = (result: DryRunResult): Effect.Effect<DryRunResult> =>
  Effect.gen(function*() {
    const decoded = yield* S.decodeUnknownEffect(S.optional(MutantCoverageSchema))(
      globalThis.__mutantCoverage__,
    ).pipe(Effect.orElseSucceed(() => undefined))
    return Option.match(Option.liftPredicate(result, isCompleteDryRun), {
      onNone: () => normalizeDryRun(result),
      onSome: (complete) =>
        Option.getOrElse(
          Option.map(Option.fromUndefinedOr(decoded), (coverage) => ({ ...complete, mutantCoverage: coverage })),
          (): DryRunResult => complete,
        ),
    })
  })

const withCoverage = (
  result: DryRunResult,
  options: DryRunOptions,
): Effect.Effect<DryRunResult> =>
  Match.value(coverageNeeded(result, options)).pipe(
    Match.when(true, () => decodeCoverageInto(result)),
    Match.when(false, () => Effect.succeed(normalizeDryRun(result))),
    Match.exhaustive,
  )

const normalizeMutantRun = (result: MutantRunResult): MutantRunResult => {
  if (result.status === 'error') {
    return { ...result, errorMessage: errorToString(result.errorMessage) }
  }
  return result
}

const readWorkerOptions = Effect.gen(function*() {
  const workerDir = process.env['STRYKER_WORKER_DIR'] ?? (yield* Effect.die(new Error('STRYKER_WORKER_DIR is not set')))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const raw = yield* fs.readFileString(path.join(workerDir, 'options.json'))
  return yield* decodeWorkerOptions(raw)
})

type TestRunnerPhase = 'capabilities' | 'init' | 'dryRun' | 'mutantRun'

export const testRunnerHandlers = TestRunnerRpcs.toLayer(
  Effect.gen(function*() {
    const options = yield* readWorkerOptions
    const runnerName = options.testRunner
    const failed = (phase: TestRunnerPhase) => (cause: Cause.Cause<unknown>): Effect.Effect<never, TestRunnerFailed> =>
      Effect.fail(new TestRunnerFailed({ cause: Cause.pretty(cause), phase, runnerName }))

    const underlying = yield* Effect.cached(
      TestRunner.pipe(
        Effect.provide(makeVitestRunnerLayer({ options, sandboxDirectory: process.cwd() })),
        Effect.flatMap((service) => service.init.pipe(Effect.as(service))),
        Effect.catchCause(failed('init')),
      ),
    )

    return {
      capabilities: () =>
        underlying.pipe(
          Effect.flatMap((service) => service.capabilities),
          Effect.catchCause(failed('capabilities')),
        ),

      dryRun: ({ options: runOptions }: { readonly options: DryRunOptions }) =>
        underlying.pipe(
          Effect.flatMap((service) => service.dryRun(runOptions)),
          Effect.flatMap((result) => withCoverage(result, runOptions)),
          Effect.catchCause(failed('dryRun')),
        ),

      mutantRun: ({ options: runOptions }: { readonly options: MutantRunOptions }) =>
        underlying.pipe(
          Effect.flatMap((service) => service.mutantRun(runOptions)),
          Effect.map(normalizeMutantRun),
          Effect.catchCause(failed('mutantRun')),
        ),
    }
  }),
)
