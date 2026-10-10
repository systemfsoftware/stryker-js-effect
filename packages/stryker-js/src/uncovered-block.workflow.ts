import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const UncoveredBlockTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/UncoveredBlock')
type UncoveredBlockTypeId = typeof UncoveredBlockTypeId

export const HeldGuard = S.Struct({
  id: Mutant.MutantId,
  guard: Mutant.Guard,
})
export type HeldGuard = typeof HeldGuard.Type

export const BlockSettlement = S.Struct({
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
})
export type BlockSettlement = typeof BlockSettlement.Type

export class UncoveredBlockCommand extends S.TaggedClass<UncoveredBlockCommand>()('UncoveredBlockCommand', {
  held: S.Array(HeldGuard),
  settlements: S.Array(BlockSettlement),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class BlockUncovered extends S.TaggedClass<BlockUncovered>()('BlockUncovered', {
  id: Mutant.MutantId,
  noCoverage: Mutant.MutantId,
}) {
  readonly [UncoveredBlockTypeId] = UncoveredBlockTypeId
}

export class GuardKept extends S.TaggedClass<GuardKept>()('GuardKept', {
  id: Mutant.MutantId,
}) {
  readonly [UncoveredBlockTypeId] = UncoveredBlockTypeId
}

export const UncoveredBlockRuling = S.Union([BlockUncovered, GuardKept])
export type UncoveredBlockRuling = typeof UncoveredBlockRuling.Type

export const UncoveredBlockRulings = S.Array(UncoveredBlockRuling)
export type UncoveredBlockRulings = typeof UncoveredBlockRulings.Type

const NO_COVERAGE_STATUS: Mutant.MutantStatus = 'NoCoverage'

const membersOf = (guard: Mutant.Guard): ReadonlyArray<Mutant.MutantId> => [guard.block, ...guard.inside]

const noCoverageIdsOf = (settlements: ReadonlyArray<BlockSettlement>): HashSet.HashSet<Mutant.MutantId> =>
  HashSet.fromIterable(
    settlements.filter((settlement) => settlement.status === NO_COVERAGE_STATUS).map((settlement) => settlement.id),
  )

const noCoverageWitnessOf = (
  noCoverageIds: HashSet.HashSet<Mutant.MutantId>,
  guard: Mutant.Guard,
): Option.Option<Mutant.MutantId> => Arr.findFirst(membersOf(guard), (member) => HashSet.has(noCoverageIds, member))

const rulingOf = (noCoverageIds: HashSet.HashSet<Mutant.MutantId>, held: HeldGuard): UncoveredBlockRuling =>
  Option.match(noCoverageWitnessOf(noCoverageIds, held.guard), {
    onNone: () => GuardKept.make({ id: held.id }),
    onSome: (noCoverage) => BlockUncovered.make({ id: held.id, noCoverage }),
  })

const rulingsOf = (command: UncoveredBlockCommand): ReadonlyArray<UncoveredBlockRuling> => {
  const noCoverageIds = noCoverageIdsOf(command.settlements)
  return Arr.map(command.held, (held) => rulingOf(noCoverageIds, held))
}

export const uncoveredBlock = Workflow.make({
  command: UncoveredBlockCommand,
  decision: UncoveredBlockRulings,
  error: S.Never,
  decide: (command: UncoveredBlockCommand): Result.Result<ReadonlyArray<UncoveredBlockRuling>, never> =>
    Result.succeed(rulingsOf(command)),
})
