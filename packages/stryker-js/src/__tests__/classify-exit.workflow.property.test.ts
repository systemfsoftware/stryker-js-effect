import { describe, it } from '@effect/vitest'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifySignalledExit,
  ClassifySignalledExitCommand,
  classifyUnsignalledExit,
  ClassifyUnsignalledExitCommand,
  type ClassifyExitDecision,
  ExitConfigErrored,
  ExitInternalErrored,
  ExitPassed,
  ExitRuntimeErrored,
  ExitVerdictFailed,
} from '../classify-exit.workflow.js'

const codeOf = (exitClass: ExitClass): number =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => 2),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const worseOf = (first: ExitClass, second: ExitClass) =>
  Boolean.match(codeOf(first) >= codeOf(second), {
    onTrue: () => first,
    onFalse: () => second,
  })

const decidedOf = (pending: ReadonlyArray<ExitClass>, score: number | null, breakingThreshold: number | null) =>
  classifyUnsignalledExit(new ClassifyUnsignalledExitCommand({ pending: [...pending], score, breakingThreshold }))

const isMemberClass = (exitClass: ExitClass, decision: ClassifyExitDecision): boolean =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => S.is(ExitVerdictFailed)(decision)),
    Match.when('ConfigError', () => S.is(ExitConfigErrored)(decision)),
    Match.when('RuntimeError', () => S.is(ExitRuntimeErrored)(decision)),
    Match.when('InternalError', () => S.is(ExitInternalErrored)(decision)),
    Match.exhaustive,
  )

describe('classifyExit', () => {
  it.prop('∀pair_Command_≡HighestSeverity', [ExitClass, ExitClass], ([first, second]) => {
    const expected = worseOf(first, second)
    const result = decidedOf([first, second], null, null)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) => isMemberClass(expected, decision),
    })
  })

  it.prop('∀single_Command_≡MemberClass', [ExitClass], ([only]) => {
    const result = decidedOf([only], null, null)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) => isMemberClass(only, decision),
    })
  })

  it.prop('∀below_Command_≡VerdictFailed', [S.Int, S.Int], ([score, threshold]) => {
    const result = decidedOf([], score, threshold)
    return Match.value(score < threshold).pipe(
      Match.when(true, () => Result.isSuccess(result) && S.is(ExitVerdictFailed)(result.success)),
      Match.orElse(() => true),
    )
  })

  it.prop('∀above_Command_≡Passed', [S.Int, S.Int], ([score, threshold]) => {
    const result = decidedOf([], score, threshold)
    return Match.value(score < threshold).pipe(
      Match.when(true, () => true),
      Match.orElse(() => Result.isSuccess(result) && S.is(ExitPassed)(result.success)),
    )
  })
  it.prop('∀empty_Command_≡Passed', [S.Int], ([threshold]) => {
    const result = decidedOf([], 10, threshold)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('ExitPassed', () => true),
          Match.tag('ExitVerdictFailed', () => 10 < threshold),
          Match.orElse(() => false),
        ),
    })
  })
})
