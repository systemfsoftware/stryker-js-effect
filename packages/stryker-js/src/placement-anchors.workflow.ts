import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const AnchoredMutantSchema = S.Struct({
  id: Mutant.MutantId,
  subsumption: S.optional(Mutant.Subsumption),
  guard: S.optional(Mutant.Guard),
})
export type AnchoredMutant = typeof AnchoredMutantSchema.Type

export class PlacementAnchorsCommand extends S.Class<PlacementAnchorsCommand>('PlacementAnchorsCommand')({
  mutants: S.Array(AnchoredMutantSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const PlacementAnchorDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/PlacementAnchorDecision',
)
type PlacementAnchorDecisionTypeId = typeof PlacementAnchorDecisionTypeId

export class Anchored extends S.TaggedClass<Anchored>()('Anchored', {
  id: Mutant.MutantId,
  anchors: S.NonEmptyArray(Mutant.MutantId),
}) {
  readonly [PlacementAnchorDecisionTypeId] = PlacementAnchorDecisionTypeId
}

export class Unanchored extends S.TaggedClass<Unanchored>()('Unanchored', {
  id: Mutant.MutantId,
}) {
  readonly [PlacementAnchorDecisionTypeId] = PlacementAnchorDecisionTypeId
}

export const PlacementAnchorDecision = S.Union([Anchored, Unanchored])
export type PlacementAnchorDecision = typeof PlacementAnchorDecision.Type
export const PlacementAnchorDecisions = S.Array(PlacementAnchorDecision)

const noIds: ReadonlyArray<Mutant.MutantId> = []

const dominatorsOf = (mutant: AnchoredMutant): ReadonlyArray<Mutant.MutantId> =>
  Option.match(Option.fromUndefinedOr(mutant.subsumption), {
    onNone: () => noIds,
    onSome: (subsumption) =>
      Match.value(subsumption).pipe(
        Match.tag('Subsumed', (subsumed): ReadonlyArray<Mutant.MutantId> => subsumed.dominators),
        Match.tag('Readmitted', () => noIds),
        Match.exhaustive,
      ),
  })

const guardBlockOf = (mutant: AnchoredMutant): ReadonlyArray<Mutant.MutantId> =>
  Option.match(Option.fromUndefinedOr(mutant.guard), {
    onNone: () => noIds,
    onSome: (guard) => [guard.block],
  })

const insideEntriesOf = (mutant: AnchoredMutant): ReadonlyArray<readonly [string, Mutant.MutantId]> =>
  Option.match(Option.fromUndefinedOr(mutant.guard), {
    onNone: (): ReadonlyArray<readonly [string, Mutant.MutantId]> => [],
    onSome: (guard) => guard.inside.map((insideId) => [insideId, guard.block] as const),
  })

const guardBlocksHoldingOf = (
  mutants: ReadonlyArray<AnchoredMutant>,
): Record.ReadonlyRecord<string, ReadonlyArray<Mutant.MutantId>> =>
  Record.map(
    Arr.groupBy(mutants.flatMap(insideEntriesOf), ([insideId]) => insideId),
    (entries) => entries.map(([, block]) => block),
  )

const anchorsOf = (
  holdingBlocks: Record.ReadonlyRecord<string, ReadonlyArray<Mutant.MutantId>>,
  mutant: AnchoredMutant,
): ReadonlyArray<Mutant.MutantId> =>
  Arr.dedupe([
    ...dominatorsOf(mutant),
    ...guardBlockOf(mutant),
    ...Option.getOrElse(Record.get(holdingBlocks, mutant.id), () => noIds),
  ])

const decisionsOf = (command: PlacementAnchorsCommand): readonly PlacementAnchorDecision[] => {
  const holdingBlocks = guardBlocksHoldingOf(command.mutants)
  return command.mutants.map((mutant) =>
    Option.match(Option.liftPredicate(anchorsOf(holdingBlocks, mutant), Arr.isReadonlyArrayNonEmpty), {
      onNone: (): PlacementAnchorDecision => Unanchored.make({ id: mutant.id }),
      onSome: (anchors) => Anchored.make({ id: mutant.id, anchors }),
    })
  )
}

export const placementAnchors = Workflow.make({
  command: PlacementAnchorsCommand,
  decision: PlacementAnchorDecisions,
  error: S.Never,
  decide: (command: PlacementAnchorsCommand): Result.Result<readonly PlacementAnchorDecision[], never> =>
    Result.succeed(decisionsOf(command)),
})
