import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { judgeMutationScore, JudgeMutationScoreCommand, ScoreJudgement } from '../judge-mutation-score.workflow.js'

type BreakThreshold = JudgeMutationScoreCommand['breakingThreshold']

const thresholdExceeds = (percentage: number, threshold: number): boolean => Math.sign(threshold - percentage) === 1

const expectedJudgement = (score: Report.MutationScore, breakingThreshold: BreakThreshold): object =>
  Report.MutationScore.match(score, {
    Scored: ({ percentage }) =>
      Match.valueTags(breakingThreshold, {
        NoBreakThreshold: () => ({ _tag: 'ScoredWithoutThreshold', percentage, exitClass: null }),
        BreakAt: ({ threshold }) =>
          thresholdExceeds(percentage, threshold)
            ? { _tag: 'ScoreBelowThreshold', percentage, threshold, exitClass: 'VerdictFail' }
            : { _tag: 'ScoreAtOrAboveThreshold', percentage, threshold, exitClass: null },
      }),
    Unscored: () =>
      Match.valueTags(breakingThreshold, {
        NoBreakThreshold: () => ({ _tag: 'UnscoredWithoutThreshold', exitClass: null }),
        BreakAt: ({ threshold }) => ({ _tag: 'UnscoredAgainstThreshold', threshold, exitClass: null }),
      }),
  })

const decodeJudgement = S.decodeUnknownResult(ScoreJudgement)

const judgedAs = (
  subject: typeof judgeMutationScore,
  score: Report.MutationScore,
  breakingThreshold: BreakThreshold,
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
    {
      of: [Report.MutationScore, S.toType(JudgeMutationScoreCommand.fields.breakingThreshold)],
      subject: judgeMutationScore,
    },
    (subject, [score, threshold]) => judgedAs(subject, score, threshold, expectedJudgement(score, threshold)),
  )

  it.prop(
    '∀p_ScoreEqualToThreshold_≡Passes',
    { of: [Report.Percentage], subject: judgeMutationScore },
    (subject, [percentage]) =>
      judgedAs(
        subject,
        Report.MutationScore.cases.Scored.make({ percentage }),
        { _tag: 'BreakAt', threshold: percentage },
        { _tag: 'ScoreAtOrAboveThreshold', percentage, threshold: percentage, exitClass: null },
      ),
  )
})
