import { Evaluator, EvaluatorFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'

import { judgeTestContribution } from './test-contribution.js'

import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'

const EXIT_VERDICT_FAIL: ExitClass = 'VerdictFail'
const VERDICT_FAIL_NOTE =
  '(sharpen or delete them, or remove the test-contribution plugin from `plugins` to prevent this error in the future)'

export const makeTestContributionEvaluatorService = (options: {
  readonly disableBail: boolean
}): { readonly evaluate: (report: schema.MutationTestResult) => Effect.Effect<ExitClass | null, EvaluatorFailed> } => ({
  evaluate: (report) =>
    Effect.flatMap(
      Effect.try({
        try: () => judgeTestContribution(report, options.disableBail === true),
        catch: (cause) => EvaluatorFailed.make({ cause }),
      }),
      (verdict) =>
        Match.value(verdict.failed).pipe(
          Match.when(true, () =>
            Effect.as(
              Effect.andThen(
                Effect.logError(`${verdict.message}\nSetting exit code to 1 (failure).`),
                () => Effect.logInfo(VERDICT_FAIL_NOTE),
              ),
              EXIT_VERDICT_FAIL,
            )),
          Match.when(false, () => Effect.as(Effect.logInfo(verdict.message), null)),
          Match.exhaustive,
        ),
    ),
})

export const testContributionEvaluatorLayer = (
  options: {
    readonly disableBail: boolean
  },
): Layer.Layer<Evaluator> => Layer.succeed(Evaluator, makeTestContributionEvaluatorService(options))
