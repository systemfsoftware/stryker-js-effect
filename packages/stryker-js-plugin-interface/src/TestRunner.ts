import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type {
  DryRunResult,
  ErrorMutantRunResult,
  FailedTestResult,
  KilledMutantRunResult,
  MutantRunResult,
  SurvivedMutantRunResult,
  TimeoutMutantRunResult,
} from './TestRunner.schema.js'

export const toMutantRunResult: {
  (dryRunResult: DryRunResult, reportAllKillers: boolean): MutantRunResult
  (reportAllKillers: boolean): (dryRunResult: DryRunResult) => MutantRunResult
} = dual(
  2,
  (dryRunResult: DryRunResult, reportAllKillers: boolean): MutantRunResult =>
    Match.value(dryRunResult).pipe(
      Match.discriminator('status')('complete', (complete): KilledMutantRunResult | SurvivedMutantRunResult => {
        const failed = complete.tests.filter(
          (t): t is FailedTestResult => t.status === 'failed',
        )
        const nrOfTests = complete.tests.filter((t) => t.status !== 'skipped').length
        return Option.match(Option.fromUndefinedOr(failed.at(0)), {
          onNone: (): SurvivedMutantRunResult => ({ nrOfTests, status: 'survived' }),
          onSome: (firstFailed): KilledMutantRunResult => ({
            failureMessage: firstFailed.failureMessage,
            killedBy: Match.value(reportAllKillers).pipe(
              Match.when(true, () => failed.map((t) => t.id)),
              Match.when(false, () => [firstFailed.id]),
              Match.exhaustive,
            ),
            nrOfTests,
            status: 'killed',
          }),
        })
      }),
      Match.discriminator('status')('error', (errored): ErrorMutantRunResult => ({
        errorMessage: errored.errorMessage,
        status: 'error',
      })),
      Match.discriminator('status')(
        'timeout',
        (timedOut): TimeoutMutantRunResult =>
          Option.match(Option.fromUndefinedOr(timedOut.reason), {
            onNone: (): TimeoutMutantRunResult => ({ status: 'timeout' }),
            onSome: (reason): TimeoutMutantRunResult => ({ reason, status: 'timeout' }),
          }),
      ),
      Match.exhaustive,
    ),
)

export function testFilesProvided(options: { readonly testFiles?: readonly string[] }): boolean {
  return options.testFiles !== undefined && options.testFiles.length > 0
}
