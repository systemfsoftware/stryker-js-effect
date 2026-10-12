import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { judgeMutationScore, JudgeMutationScoreCommand, ScoreJudgement } from '../judge-mutation-score.workflow.js'

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

const decodeJudgement = S.decodeUnknownResult(ScoreJudgement)

const judgedAs = (
  subject: typeof judgeMutationScore,
  score: Report.MutationScore,
  breakingThreshold: number | null,
  expected: object,
): boolean =>
  Result.match(
    Result.all([subject(JudgeMutationScoreCommand.make({ score, breakingThreshold })), decodeJudgement(expected)]),
    {
      onFailure: () => false,
      onSuccess: ([decision, judgement]) => S.toEquivalence(ScoreJudgement)(decision, judgement),
    },
  )

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
