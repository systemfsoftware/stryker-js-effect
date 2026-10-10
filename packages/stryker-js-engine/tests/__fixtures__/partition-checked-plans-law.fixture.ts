import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const CheckedEntry = S.Struct({ mutantId: Mutant.MutantId, result: Checker.CheckResultSchema })
export type CheckedEntry = typeof CheckedEntry.Type

export const CheckedHistoryEntry = S.Struct({
  mutantId: S.Literals(['0000000000000001', '0000000000000002', '0000000000000003']),
  outcome: S.Literals(['passed', 'compileError-a', 'compileError-b']),
})
export type CheckedHistoryEntry = typeof CheckedHistoryEntry.Type
