import { describe, it } from '@effect/vitest'
import { ExitClass, ExitCodeFromClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyExit,
  ClassifyExitCommand,
  ExitConfigErrored,
  ExitInternalErrored,
  ExitPassed,
  ExitRuntimeErrored,
  ExitVerdictFailed,
} from '../classify-exit.workflow.js'

const codeOf = (exitClass: ExitClass): number =>
  Option.getOrElse(S.decodeUnknownOption(ExitCodeFromClass)(exitClass), () => -1)

const decidedOf = (pending: ReadonlyArray<ExitClass>, score: number | null, breakingThreshold: number | null) =>
  classifyExit(new ClassifyExitCommand({ pending: [...pending], signal: null, score, breakingThreshold }))

const tagOf = (exitClass: ExitClass): string =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => ExitVerdictFailed.make({})._tag),
    Match.when('ConfigError', () => ExitConfigErrored.make({})._tag),
    Match.when('RuntimeError', () => ExitRuntimeErrored.make({})._tag),
    Match.when('InternalError', () => ExitInternalErrored.make({})._tag),
    Match.exhaustive,
  )

describe('classifyExit', () => {
  it.prop('∀pair_Command_≡HighestSeverity', [ExitClass, ExitClass], ([first, second]) => {
    const expected = codeOf(first) >= codeOf(second) ? first : second
    const result = decidedOf([first, second], null, null)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) => decision._tag === tagOf(expected),
    })
  })

  it.prop('∀single_Command_≡MemberClass', [ExitClass], ([only]) => {
    const result = decidedOf([only], null, null)
    return Result.match(result, {
      onFailure: () => false,
      onSuccess: (decision) => decision._tag === tagOf(only),
    })
  })

  it.prop('∀below_Command_≡VerdictFailed', [S.Int, S.Int], ([score, threshold]) => {
    const result = decidedOf([], score, threshold)
    return Match.value(score < threshold).pipe(
      Match.when(true, () => Result.isSuccess(result) && result.success._tag === 'ExitVerdictFailed'),
      Match.orElse(() => true),
    )
  })

  it.prop('∀above_Command_≡Passed', [S.Int, S.Int], ([score, threshold]) => {
    const result = decidedOf([], score, threshold)
    return Match.value(score < threshold).pipe(
      Match.when(true, () => true),
      Match.orElse(() => Result.isSuccess(result) && result.success._tag === 'ExitPassed'),
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
