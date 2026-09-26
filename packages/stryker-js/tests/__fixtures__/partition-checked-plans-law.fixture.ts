import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const CheckedEntry = S.Struct({ mutantId: Mutant.MutantId, result: Checker.CheckResultSchema })
export type CheckedEntry = typeof CheckedEntry.Type

export const CheckedHistoryEntry = S.Struct({
  mutantId: S.Literals(['1', '2', '3']),
  outcome: S.Literals(['passed', 'compileError-a', 'compileError-b']),
})
export type CheckedHistoryEntry = typeof CheckedHistoryEntry.Type
