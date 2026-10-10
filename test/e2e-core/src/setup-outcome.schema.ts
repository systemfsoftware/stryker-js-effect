import * as S from 'effect/Schema'

import { BenchSide } from './bench-run.schema.js'

const FailureFields = {
  step: S.NonEmptyString,
  reason: S.String,
  outputTail: S.String,
}

export const SetupFailure = S.TaggedUnion({
  exited: FailureFields,
  overran: FailureFields,
  'out-of-time': FailureFields,
})
export type SetupFailure = typeof SetupFailure.Type

export const SetupRecovery = S.TaggedUnion({
  none: {},
  retried: { steps: S.NonEmptyArray(S.NonEmptyString) },
})
export type SetupRecovery = typeof SetupRecovery.Type

export const SideSetup = S.TaggedUnion({
  ready: { recovered: SetupRecovery },
  failed: { failure: SetupFailure },
})
export type SideSetup = typeof SideSetup.Type

export const SetupRedCode = S.Literals(['side-setup-failed', 'setup-timed-out'])
export type SetupRedCode = typeof SetupRedCode.Type

export const SetupInconclusiveCode = S.Literals(['setup-external', 'base-setup-failed'])
export type SetupInconclusiveCode = typeof SetupInconclusiveCode.Type

const SetupVerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/SetupVerdict')
type SetupVerdictTypeId = typeof SetupVerdictTypeId

export class SetupProceed extends S.TaggedClass<SetupProceed>()('proceed', {}) {
  readonly [SetupVerdictTypeId] = SetupVerdictTypeId
}

export class SetupRed extends S.TaggedClass<SetupRed>()('red', {
  side: BenchSide,
  code: SetupRedCode,
  step: S.NonEmptyString,
  reason: S.String,
}) {
  readonly [SetupVerdictTypeId] = SetupVerdictTypeId
}

export class SetupInconclusive extends S.TaggedClass<SetupInconclusive>()('inconclusive', {
  code: SetupInconclusiveCode,
  step: S.NonEmptyString,
  reason: S.String,
}) {
  readonly [SetupVerdictTypeId] = SetupVerdictTypeId
}

export const SetupVerdict = S.Union([SetupProceed, SetupRed, SetupInconclusive])
export type SetupVerdict = typeof SetupVerdict.Type
