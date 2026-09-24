// Throwaway old-vs-new evidence vs the 432b15ac3 baseline (oracle quoted from its dist); run, report, delete.
import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { DryRunResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import type { DryRunResult, MutantRunResult } from '@systemfsoftware/stryker-js-plugin-interface'

import { InterpretDryRunResultCommand, interpretDryRunResult } from './interpret-dry-run-result.workflow.js'

const toMutantRunResultBaseline = (dryRunResult: DryRunResult): MutantRunResult =>
  Match.value(dryRunResult).pipe(
    Match.discriminator('status')('complete', (complete) => {
      const failed = complete.tests.filter((test) => test.status === 'failed')
      const nrOfTests = complete.tests.filter((test) => test.status !== 'skipped').length
      return Option.match(Option.fromUndefinedOr(failed.at(0)), {
        onNone: () => ({ nrOfTests, status: 'survived' as const }),
        onSome: (firstFailed) => ({
          failureMessage: firstFailed.failureMessage,
          killedBy: failed.map((test) => test.id),
          nrOfTests,
          status: 'killed' as const,
        }),
      })
    }),
    Match.discriminator('status')('error', (errored) => ({
      errorMessage: errored.errorMessage,
      status: 'error' as const,
    })),
    Match.discriminator('status')('timeout', (timedOut) =>
      Option.match(Option.fromUndefinedOr(timedOut.reason), {
        onNone: () => ({ status: 'timeout' as const }),
        onSome: (reason) => ({ reason, status: 'timeout' as const }),
      })),
    Match.exhaustive,
  )

it.prop('∀dryRun_WorkflowAndWire_=toMutantRunResultBaseline', [DryRunResultSchema], ([dryRunResult]) =>
  Result.match(
    interpretDryRunResult(InterpretDryRunResultCommand.make({ dryRunResult })),
    {
      onFailure: () => false,
      onSuccess: (decision) => {
        const wire: MutantRunResult = Match.value(decision).pipe(
          Match.tag('Killed', (killed) => ({
            failureMessage: killed.failureMessage,
            killedBy: killed.killedBy,
            nrOfTests: killed.nrOfTests,
            status: 'killed' as const,
          })),
          Match.tag('Survived', (survived) => ({ nrOfTests: survived.nrOfTests, status: 'survived' as const })),
          Match.tag('Timeout', (timedOut) =>
            Option.match(Option.fromUndefinedOr(timedOut.reason), {
              onNone: () => ({ status: 'timeout' as const }),
              onSome: (reason) => ({ reason, status: 'timeout' as const }),
            })),
          Match.tag('Error', (errored) => ({ errorMessage: errored.errorMessage, status: 'error' as const })),
          Match.exhaustive,
        )
        return JSON.stringify(wire) === JSON.stringify(toMutantRunResultBaseline(dryRunResult))
      },
    },
  ))
