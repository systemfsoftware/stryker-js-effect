import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type { RunnerTestCase } from 'vitest'

import { interpretVitestMutantRun } from './interpret-vitest-mutant-run.workflow.js'
import type { VitestRunnerOptions } from './VitestRunner.schema.js'
import type { RunFilter } from './VitestRunner.service.js'
import { VitestSession } from './VitestSession.service.js'

/** What one mutant run needs from the runner: raw collection, hit harvesting and the trap options. */
export interface MutantRunCellDeps {
  readonly collectRaw: (
    filter: RunFilter,
  ) => Effect.Effect<
    {
      readonly rawTests: readonly RunnerTestCase[]
      readonly fileFailures: readonly { readonly fileName: string; readonly message: string }[]
      readonly hasExternalError: boolean
      readonly externalErrorText: string
    },
    TestRunner.TestRunnerFailed
  >
  readonly hitCount: Effect.Effect<number | undefined>
  readonly reportAllKillers: boolean
  readonly projectRoot: string
  readonly vitestOptions: Effect.Effect<VitestRunnerOptions, TestRunner.TestRunnerFailed>
}

export const makeMutantRunCell = (deps: MutantRunCellDeps) =>
  Sandwich.named('stryker.vitest.mutant_run')((command: Mutant.MutantRunOptions) =>
    Effect.gen(function*() {
      const session = yield* VitestSession
      yield* session.setMode('mutant')
      yield* session.provide('hitLimit', command.hitLimit)
      yield* session.provide('mutantActivation', command.mutantActivation)
      yield* session.provide('activeMutant', command.activeMutant.id)
      const { rawTests, fileFailures, hasExternalError, externalErrorText } = yield* deps.collectRaw({
        testIds: Option.getOrUndefined(
          Option.map(Option.fromNullishOr(command.testFilter), (ids) => [...ids]),
        ),
        relatedFiles: [command.sandboxFileName],
      })
      const hitCount = yield* deps.hitCount
      const reportAllKillers = deps.reportAllKillers
      const vitestOptions = yield* deps.vitestOptions
      return {
        _tag: 'VitestMutantRunCommand' as const,
        tests: { projectRoot: deps.projectRoot, records: rawTests, fileFailures },
        hasExternalError,
        externalErrorText,
        hitCount,
        hitLimit: command.hitLimit,
        reportAllKillers,
        activeMutantId: command.activeMutant.id,
        activeMutantFileName: command.activeMutant.fileName,
        timeoutTrapFile: vitestOptions.timeoutTrapFile,
        timeoutTrapMutantId: vitestOptions.timeoutTrapMutantId,
      }
    })
  )
    .decide(interpretVitestMutantRun)
    .write({
      Killed: (killed) =>
        Effect.succeed({
          status: 'killed' as const,
          failureMessage: killed.failureMessage ?? '',
          killedBy: Option.getOrElse(
            Option.map(Option.fromNullishOr(killed.killerIds), (ids) => [...ids]),
            () => [],
          ),
          nrOfTests: killed.tests.length,
        }),
      Survived: (survived) => Effect.succeed({ status: 'survived' as const, nrOfTests: survived.tests.length }),
      Timeout: (timeout) =>
        Effect.succeed({
          status: 'timeout' as const,
          ...Option.getOrElse(
            Option.map(Option.fromNullishOr(timeout.reason), (reason) => ({ reason })),
            () => ({}),
          ),
        }),
      Error: (error) => Effect.succeed({ status: 'error' as const, errorMessage: error.errorMessage ?? 'unknown' }),
      CommandRejected: ({ issue }) =>
        Effect.fail(new TestRunner.TestRunnerFailed({ runnerName: 'vitest', phase: 'mutantRun', cause: issue })),
    })
