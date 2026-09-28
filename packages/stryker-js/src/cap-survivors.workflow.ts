import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const SurvivorRef = S.Struct({
  id: Mutant.MutantId,
  fileName: S.String,
  line: Mutant.Line,
})

export type SurvivorRef = typeof SurvivorRef.Type

export const SurfacingCaps = S.Struct({
  perLine: S.Natural,
  perFile: S.Natural,
})

export type SurfacingCaps = typeof SurfacingCaps.Type

const fileOrder = Order.mapInput(Order.String, (survivor: SurvivorRef) => survivor.fileName)
const lineOrder = Order.mapInput(Order.Number, (survivor: SurvivorRef) => survivor.line)
const idOrder = Order.mapInput(Order.String, (survivor: SurvivorRef) => survivor.id)

const positionOrder: Order.Order<SurvivorRef> = Order.combine(fileOrder, Order.combine(lineOrder, idOrder))

const lineKeyOf = (survivor: SurvivorRef): string => `${survivor.fileName}\u0000${survivor.line}`
const fileKeyOf = (survivor: SurvivorRef): string => survivor.fileName

const takesFirstPerKey = (
  survivors: ReadonlyArray<SurvivorRef>,
  keyOf: (survivor: SurvivorRef) => string,
  perKey: number,
): ReadonlyArray<SurvivorRef> =>
  Arr.flatMap(
    Object.values(Arr.groupBy(Arr.sort(survivors, positionOrder), keyOf)),
    (group) => Arr.take(Arr.sort(group, idOrder), perKey),
  )

const withDistinctIds = (survivors: ReadonlyArray<SurvivorRef>): ReadonlyArray<SurvivorRef> =>
  Arr.dedupeWith(survivors, (left, right) => left.id === right.id)

const CapSurvivorsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CapSurvivorsDecision')
type CapSurvivorsTypeId = typeof CapSurvivorsTypeId

export class SurvivorsWithinCaps extends S.TaggedClass<SurvivorsWithinCaps>()('SurvivorsWithinCaps', {
  surfaced: S.Array(SurvivorRef),
}) {
  readonly [CapSurvivorsTypeId] = CapSurvivorsTypeId
}

export class SurvivorsCapped extends S.TaggedClass<SurvivorsCapped>()('SurvivorsCapped', {
  surfaced: S.Array(SurvivorRef),
  capped: S.Array(SurvivorRef),
}) {
  readonly [CapSurvivorsTypeId] = CapSurvivorsTypeId
}

export const CapSurvivorsDecision = S.Union([SurvivorsWithinCaps, SurvivorsCapped])
export type CapSurvivorsDecision = typeof CapSurvivorsDecision.Type

export class CapSurvivorsCommand extends S.TaggedClass<CapSurvivorsCommand>()('CapSurvivorsCommand', {
  survivors: S.Array(SurvivorRef),
  caps: SurfacingCaps,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const selectionOf = (command: CapSurvivorsCommand): CapSurvivorsDecision => {
  const distinct = withDistinctIds(command.survivors)
  const picks = takesFirstPerKey(distinct, lineKeyOf, command.caps.perLine)
  const surfaced = Arr.sort(takesFirstPerKey(picks, fileKeyOf, command.caps.perFile), positionOrder)
  const surfacedIds = HashSet.fromIterable(Arr.map(surfaced, (survivor) => survivor.id))
  const capped = Arr.sort(
    Arr.filter(distinct, (survivor) => !HashSet.has(surfacedIds, survivor.id)),
    positionOrder,
  )
  return Boolean.match(capped.length === 0, {
    onTrue: () => SurvivorsWithinCaps.make({ surfaced }),
    onFalse: () => SurvivorsCapped.make({ surfaced, capped }),
  })
}

export const capSurvivors = Workflow.make({
  command: CapSurvivorsCommand,
  decision: CapSurvivorsDecision,
  error: S.Never,
  decide: (command): Result.Result<CapSurvivorsDecision, never> => Result.succeed(selectionOf(command)),
})
