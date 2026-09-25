import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyExit,
  ClassifyExitCommand,
  type ClassifyExitDecision,
  ExitConfigErrored,
  ExitInternalErrored,
  ExitPassed,
  ExitRuntimeErrored,
  ExitVerdictFailed,
} from '../classify-exit.workflow.js'

const codeOf = (exitClass: Plugin.ExitClass): number =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => 2),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const worseOf = (first: Plugin.ExitClass, second: Plugin.ExitClass) =>
  Boolean.match(codeOf(first) >= codeOf(second), {
    onTrue: () => first,
    onFalse: () => second,
  })

const UNSCORED = Report.MutationScore.cases.Unscored.make({})

const decidedOf = (
  subject: typeof classifyExit,
  pending: ReadonlyArray<Plugin.ExitClass>,
  score: Report.MutationScore,
  breakingThreshold: number | null,
) => subject(ClassifyExitCommand.make({ pending: [...pending], score, breakingThreshold }))

const isMemberClass = (exitClass: Plugin.ExitClass, decision: ClassifyExitDecision): boolean =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => S.is(ExitVerdictFailed)(decision)),
    Match.when('ConfigError', () => S.is(ExitConfigErrored)(decision)),
    Match.when('RuntimeError', () => S.is(ExitRuntimeErrored)(decision)),
    Match.when('InternalError', () => S.is(ExitInternalErrored)(decision)),
    Match.exhaustive,
  )

describe('classifyExit', () => {
  it.prop(
    '∀pair_Command_≡HighestSeverity',
    { of: [Plugin.ExitClass, Plugin.ExitClass], subject: classifyExit },
    (subject, [first, second]) => {
      const expected = worseOf(first, second)
      const result = decidedOf(subject, [first, second], UNSCORED, null)
      return Result.match(result, {
        onFailure: () => false,
        onSuccess: (decision) => isMemberClass(expected, decision),
      })
    },
  )

  it.prop(
    '∀single_Command_≡MemberClass',
    { of: [Plugin.ExitClass], subject: classifyExit },
    (subject, [only]) => {
      const result = decidedOf(subject, [only], UNSCORED, null)
      return Result.match(result, {
        onFailure: () => false,
        onSuccess: (decision) => isMemberClass(only, decision),
      })
    },
  )

  it.prop(
    '∀st_Command_≡VerdictFailedIffScoredBelowThreshold',
    { of: [Report.MutationScore, S.NullOr(Report.Percentage)], subject: classifyExit },
    (subject, [score, threshold]) => {
      const breaks = Report.MutationScore.match(score, {
        Scored: ({ percentage }) => threshold !== null && percentage < threshold,
        Unscored: () => false,
      })
      const result = decidedOf(subject, [], score, threshold)
      return Result.isSuccess(result) &&
        (breaks ? S.is(ExitVerdictFailed)(result.success) : S.is(ExitPassed)(result.success))
    },
  )
})
