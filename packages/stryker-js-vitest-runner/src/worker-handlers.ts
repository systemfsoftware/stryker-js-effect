import {
  type DryRunOptions,
  type DryRunResult,
  errorToString,
  type MutantRunOptions,
  type MutantRunResult,
  TestRunner,
  TestRunnerFailed,
} from '@systemfsoftware/stryker-js-language'
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { readWorkerOptionsFromEnv } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'

import { makeVitestRunnerLayer } from './Runner.js'

const normalizeDryRun = (result: DryRunResult): DryRunResult => {
  if (result.status === 'error') {
    return { ...result, errorMessage: errorToString(result.errorMessage) }
  }
  return result
}

const normalizeMutantRun = (result: MutantRunResult): MutantRunResult => {
  if (result.status === 'error') {
    return { ...result, errorMessage: errorToString(result.errorMessage) }
  }
  return result
}

type TestRunnerPhase = 'capabilities' | 'init' | 'dryRun' | 'mutantRun'

export const testRunnerHandlers = TestRunnerRpcs.toLayer(
  Effect.gen(function*() {
    const options = yield* readWorkerOptionsFromEnv
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
          Effect.map(normalizeDryRun),
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
