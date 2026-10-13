import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array as Arr, Boolean, Order } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CaseProbeTypeId = Symbol.for('@systemfsoftware/stryker-js/CaseProbeDecision')
type CaseProbeTypeId = typeof CaseProbeTypeId

const PROBED_NAMES = 16

const swapCase = (name: string) =>
  name.split('').map((char) =>
    Boolean.match(char === char.toLowerCase(), {
      onTrue: () => char.toUpperCase(),
      onFalse: () => char.toLowerCase(),
    })
  ).join('')

const swapsCaseCleanly = (name: string) => Boolean.every([swapCase(name) !== name, swapCase(swapCase(name)) === name])

export class CaseProbeCommand extends S.TaggedClass<CaseProbeCommand>()('CaseProbeCommand', {
  names: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class CaseProbePairs extends S.TaggedClass<CaseProbePairs>()('CaseProbePairs', {
  pairs: S.NonEmptyArray(S.Struct({ name: S.String, swapped: S.String })),
}) {
  readonly [CaseProbeTypeId] = CaseProbeTypeId
}

export class NoCaseToProbe extends S.TaggedClass<NoCaseToProbe>()('NoCaseToProbe', {}) {
  readonly [CaseProbeTypeId] = CaseProbeTypeId
}

export const CaseProbeDecision = S.Union([CaseProbePairs, NoCaseToProbe])
export type CaseProbeDecision = typeof CaseProbeDecision.Type

const pairsOf = (names: ReadonlyArray<string>) =>
  Arr.take(Arr.filter(Arr.sort(names, Order.String), swapsCaseCleanly), PROBED_NAMES).map((name) => ({
    name,
    swapped: swapCase(name),
  }))

export const admitCaseProbe = Workflow.make({
  command: CaseProbeCommand,
  decision: CaseProbeDecision,
  error: S.Never,
  decide: (command): Result.Result<CaseProbeDecision, never> =>
    Result.succeed(
      Arr.match(pairsOf(command.names), {
        onEmpty: () => NoCaseToProbe.make({}),
        onNonEmpty: (pairs) => CaseProbePairs.make({ pairs }),
      }),
    ),
})
