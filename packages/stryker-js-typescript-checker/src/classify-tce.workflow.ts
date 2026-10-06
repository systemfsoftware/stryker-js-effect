import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const TceDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/TceDecision',
)
type TceDecisionTypeId = typeof TceDecisionTypeId

export const TceClassification = S.Literals(['original', 'sibling'])
export type TceClassification = typeof TceClassification.Type

export const TceCandidate = S.Struct({
  id: S.String,
  site: S.String,
  emit: S.String,
})
export type TceCandidate = typeof TceCandidate.Type

const candidateIdsAreDistinct = S.makeFilter(
  (candidates: ReadonlyArray<TceCandidate>): string | undefined =>
    Option.getOrUndefined(
      Option.map(
        Option.fromUndefinedOr(Mutant.duplicatedValue(candidates.map((candidate) => candidate.id))),
        (duplicated) => `candidate ids must identify distinct mutants, got "${duplicated}"`,
      ),
    ),
  { arbitraryConstraint: { uniqueBy: (candidate: TceCandidate) => candidate.id } },
)

const DistinctCandidates = S.Array(TceCandidate).check(candidateIdsAreDistinct)

export class TceDecision extends S.TaggedClass<TceDecision>()('TceDecision', {
  id: S.String,
  classification: TceClassification,
}) {
  readonly [TceDecisionTypeId] = TceDecisionTypeId
}

export class ClassifyTceCommand extends S.TaggedClass<ClassifyTceCommand>()('ClassifyTceCommand', {
  originalEmit: S.String,
  candidates: DistinctCandidates,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface IndexedCandidate {
  readonly candidate: TceCandidate
  readonly original: boolean
  readonly sibling: boolean
}

const matchesEarlierSibling = (candidates: readonly TceCandidate[], index: number): boolean =>
  Option.match(Option.fromUndefinedOr(candidates[index]), {
    onNone: () => false,
    onSome: (candidate) =>
      Arr.some(
        Arr.take(candidates, index),
        (earlier) => Boolean.and(earlier.site === candidate.site, earlier.emit === candidate.emit),
      ),
  })

const indexedOf = (command: ClassifyTceCommand): ReadonlyArray<IndexedCandidate> =>
  Arr.map(command.candidates, (candidate, index) => ({
    candidate,
    original: candidate.emit === command.originalEmit,
    sibling: matchesEarlierSibling(command.candidates, index),
  }))

const classifyOf = (command: ClassifyTceCommand): ReadonlyArray<TceDecision> =>
  Arr.filterMap(indexedOf(command), (entry): Result.Result<TceDecision, void> =>
    Boolean.match(entry.original, {
      onTrue: () => Result.succeed(TceDecision.make({ id: entry.candidate.id, classification: 'original' })),
      onFalse: () =>
        Boolean.match(entry.sibling, {
          onTrue: () => Result.succeed(TceDecision.make({ id: entry.candidate.id, classification: 'sibling' })),
          onFalse: () => Result.failVoid,
        }),
    }))

export const classifyTce = Workflow.make({
  command: ClassifyTceCommand,
  decision: S.Array(TceDecision),
  error: S.Never,
  decide: (command): Result.Result<ReadonlyArray<TceDecision>, never> => Result.succeed(classifyOf(command)),
})
