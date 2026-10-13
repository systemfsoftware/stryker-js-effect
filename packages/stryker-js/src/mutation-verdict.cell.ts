import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import { judgeMutationScore } from './judge-mutation-score.workflow.js'

export interface MutationVerdictInput {
  readonly metrics: Report.MetricsResult
  readonly breakingThreshold: number | null
}

const readMutationVerdict = (input: MutationVerdictInput) =>
  Effect.succeed({
    _tag: 'JudgeMutationScoreCommand' as const,
    score: input.metrics.metrics.mutationScore,
    breakingThreshold: input.breakingThreshold,
  })

export const mutationVerdictCell = Sandwich.named(SpanTaxonomy.Spans.mutationReportingJudgeScore.name)(
  readMutationVerdict,
)
  .decide(judgeMutationScore)
  .write({
    ScoredWithoutThreshold: ({ exitClass }) =>
      Effect.as(
        Effect.logDebug(
          "No breaking threshold configured. Won't fail the build no matter how low your mutation score is. Set `thresholds.break` to change this behavior.",
        ),
        exitClass,
      ),
    ScoreAtOrAboveThreshold: ({ percentage, threshold, exitClass }) =>
      Effect.as(
        Effect.logInfo(
          `Final mutation score of ${percentage.toFixed(2)} is greater than or equal to break threshold ${
            String(threshold)
          }`,
        ),
        exitClass,
      ),
    ScoreBelowThreshold: ({ percentage, threshold, exitClass }) =>
      Effect.as(
        Effect.andThen(
          Effect.logError(
            `Final mutation score ${percentage.toFixed(2)} under breaking threshold ${
              String(threshold)
            }, setting exit code to 1 (failure).`,
          ),
          Effect.logInfo(
            '(improve mutation score or set `thresholds.break = null` to prevent this error in the future)',
          ),
        ),
        exitClass,
      ),
    UnscoredAgainstThreshold: ({ threshold, exitClass }) =>
      Effect.as(
        Effect.logInfo(
          `No valid mutant was tested, so there is no mutation score to hold against break threshold ${
            String(threshold)
          }`,
        ),
        exitClass,
      ),
    UnscoredWithoutThreshold: ({ exitClass }) => Effect.succeed(exitClass),
    CommandRejected: () => Effect.succeed<Plugin.ExitClass>('InternalError'),
  })
