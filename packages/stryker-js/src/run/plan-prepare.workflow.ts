import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PrepareDecisionTypeId = Symbol.for('@systemfsoftware/stryker-js/PrepareDecision')
type PrepareDecisionTypeId = typeof PrepareDecisionTypeId

export class PrepareDecoded extends S.Class<PrepareDecoded>('PrepareDecoded')({
  mode: S.Literals(['human', 'machine']),
  reporters: S.Array(S.String),
  fileCount: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    mode: 'stryker.prepare.mode',
    fileCount: 'stryker.prepare.file_count',
  } as const
}

export class HumanReporters extends S.TaggedClass<HumanReporters>()('HumanReporters', {
  reporters: S.Array(S.String),
}) {
  readonly [PrepareDecisionTypeId] = PrepareDecisionTypeId
}

export class MachineReporters extends S.TaggedClass<MachineReporters>()('MachineReporters', {
  reporters: S.Array(S.String),
}) {
  readonly [PrepareDecisionTypeId] = PrepareDecisionTypeId
}

export type PrepareDecision = HumanReporters | MachineReporters

export const planPrepare = Workflow.make({
  command: PrepareDecoded,
  decision: S.Union([HumanReporters, MachineReporters]),
  error: S.Never,
  decide: (decoded): Result.Result<PrepareDecision, never> =>
    Match.value(decoded.mode).pipe(
      Match.when('human', () => Result.succeed(HumanReporters.make({ reporters: decoded.reporters }))),
      Match.when('machine', () => Result.succeed(MachineReporters.make({ reporters: decoded.reporters }))),
      Match.exhaustive,
    ),
})
