import * as S from 'effect/Schema'

import { FailureCode, NextAction, NonReplayReason } from './failure-record.schema.js'

export const CapsuleRule = S.Union([S.Literal('replays'), NonReplayReason])
export type CapsuleRule = typeof CapsuleRule.Type

export const CatalogExitCode = S.Literals([1, 2, 3, 4, 5, 130])
export type CatalogExitCode = typeof CatalogExitCode.Type

export const CatalogEntry = S.Struct({
  id: FailureCode,
  name: FailureCode,
  meaning: S.NonEmptyString,
  exitCode: S.NullOr(CatalogExitCode),
  nextAction: NextAction,
  capsule: CapsuleRule,
})
export type CatalogEntry = typeof CatalogEntry.Type
