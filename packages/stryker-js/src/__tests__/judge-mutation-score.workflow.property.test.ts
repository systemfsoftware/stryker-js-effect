import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { judgeMutationScore, JudgeMutationScoreCommand } from '../judge-mutation-score.workflow.js'

const thresholdExceeds = (percentage: number, threshold: number): boolean => Math.sign(threshold - percentage) === 1

const expectedJudgement = (score: Report.MutationScore, threshold: number | null): object =>
  Report.MutationScore.match<object>(score, {
    Scored: ({ percentage }) =>
      threshold === null
        ? { _tag: 'ScoredWithoutThreshold', percentage, exitClass: null }
        : thresholdExceeds(percentage, threshold)
        ? { _tag: 'ScoreBelowThreshold', percentage, threshold, exitClass: 'VerdictFail' }
        : { _tag: 'ScoreAtOrAboveThreshold', percentage, threshold, exitClass: null },
    Unscored: () =>
      threshold === null
        ? { _tag: 'UnscoredWithoutThreshold', exitClass: null }
        : { _tag: 'UnscoredAgainstThreshold', threshold, exitClass: null },
  })

const fieldsOf = (value: object): string =>
  JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))

const judgedAs = (
  subject: typeof judgeMutationScore,
  score: Report.MutationScore,
  breakingThreshold: number | null,
  expected: object,
): boolean =>
  Result.match(subject(JudgeMutationScoreCommand.make({ score, breakingThreshold })), {
    onFailure: () => false,
    onSuccess: (decision) => fieldsOf(decision) === fieldsOf(expected),
  })

describe('judgeMutationScore', () => {
  it.prop(
    '∀st_Command_≡VerdictFailedIffScoredBelowThreshold',
    { of: [Report.MutationScore, S.NullOr(Report.Percentage)], subject: judgeMutationScore },
    (subject, [score, threshold]) => judgedAs(subject, score, threshold, expectedJudgement(score, threshold)),
  )

  it.prop(
    '∀p_ScoreEqualToThreshold_≡Passes',
    { of: [Report.Percentage], subject: judgeMutationScore },
    (subject, [percentage]) =>
      judgedAs(subject, Report.MutationScore.cases.Scored.make({ percentage }), percentage, {
        _tag: 'ScoreAtOrAboveThreshold',
        percentage,
        threshold: percentage,
        exitClass: null,
      }),
  )
})
