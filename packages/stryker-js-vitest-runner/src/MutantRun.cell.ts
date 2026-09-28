import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { interpretVitestMutantRun } from './interpret-vitest-mutant-run.workflow.js'
import type { VitestTestRecord } from './vitest-run-command.schema.js'
import { interpretVitestTestRun } from './vitest-test-run.js'
import type { VitestRunnerOptions } from './VitestRunner.schema.js'
import type { RunFilter } from './VitestRunner.service.js'
import { VitestSession } from './VitestSession.service.js'

/** What one mutant run needs from the runner: raw collection, hit harvesting and the trap options. */
export interface MutantRunCellDeps {
  readonly collectRaw: (
    filter: RunFilter,
  ) => Effect.Effect<
    {
      readonly records: readonly VitestTestRecord[]
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
  Sandwich.named(SpanTaxonomy.Spans.vitestMutantRun.name)(
    Effect.fn(SpanTaxonomy.Spans.vitestMutantRunRead.name)(function*(command: Mutant.MutantRunOptions) {
      const session = yield* VitestSession
      yield* session.setMode('mutant')
      yield* session.provide('hitLimit', command.hitLimit)
      yield* session.provide('mutantActivation', command.mutantActivation)
      yield* session.provide('activeMutant', command.activeMutant.id)
      const { records, fileFailures, hasExternalError, externalErrorText } = yield* deps.collectRaw({
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
        tests: interpretVitestTestRun({ projectRoot: deps.projectRoot, records, fileFailures }),
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
    }),
  )
    .decide(interpretVitestMutantRun)
    .write({
      Killed: (killed) =>
        Effect.succeed({
          status: 'killed' as const,
          failureMessage: killed.failureMessage ?? '',
          killedBy: Option.getOrElse(
            Option.map(
              Option.fromNullishOr(killed.killerIds),
              (ids) => ids.map((id) => TestRunner.TestId.make(id)),
            ),
            () => [],
          ),
          nrOfTests: killed.tests.length,
          executedTests: killed.executedTests.map((test) => ({
            id: TestRunner.TestId.make(test.id),
            timeSpentMs: test.timeSpentMs,
          })),
        }),
      Survived: (survived) =>
        Effect.succeed({
          status: 'survived' as const,
          nrOfTests: survived.tests.length,
          executedTests: survived.executedTests.map((test) => ({
            id: TestRunner.TestId.make(test.id),
            timeSpentMs: test.timeSpentMs,
          })),
        }),
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
