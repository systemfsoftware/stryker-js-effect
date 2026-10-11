import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CollectionSizeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/CollectionSizeDecision',
)
type CollectionSizeDecisionTypeId = typeof CollectionSizeDecisionTypeId

export const SizeOperator = S.Literals(['<', '<=', '>', '>='])
export type SizeOperator = typeof SizeOperator.Type

export const LengthSide = S.Literals(['left', 'right'])
export type LengthSide = typeof LengthSide.Type

export const ReceiverKind = S.Literals(['array', 'tuple', 'string', 'other'])
export type ReceiverKind = typeof ReceiverKind.Type

export const SizeComparison = S.Struct({
  operator: SizeOperator,
  lengthSide: LengthSide,
  againstZero: S.Boolean,
  receiver: S.Array(ReceiverKind),
  referenceReceiver: S.Boolean,
  strictNullChecks: S.Boolean,
})
export type SizeComparison = typeof SizeComparison.Type

export const SiteCandidate = S.Struct({
  id: S.String,
  kept: S.Boolean,
  literal: S.Option(S.Boolean),
  comparison: S.Option(SizeComparison),
})
export type SiteCandidate = typeof SiteCandidate.Type

export const MutantSite = S.Struct({ candidates: S.Array(SiteCandidate) })
export type MutantSite = typeof MutantSite.Type

export class CollectionSizeDecision extends S.TaggedClass<CollectionSizeDecision>()('CollectionSizeDecision', {
  id: S.String,
  always: S.Boolean,
}) {
  readonly [CollectionSizeDecisionTypeId] = CollectionSizeDecisionTypeId
}

export class ClassifyCollectionSizeCommand extends S.TaggedClass<ClassifyCollectionSizeCommand>()(
  'ClassifyCollectionSizeCommand',
  { sites: S.Array(MutantSite) },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ALWAYS: { readonly [side in LengthSide]: { readonly [operator in SizeOperator]?: boolean } } = {
  left: { '>=': true, '<': false },
  right: { '<=': true, '>': false },
}

const receiverIsCollection = (receiver: ReadonlyArray<ReceiverKind>): boolean =>
  Boolean.every([receiver.length > 0, Arr.every(receiver, (kind) => kind !== 'other')])

const constantOf = (comparison: SizeComparison): Option.Option<boolean> =>
  Option.filter(
    Option.fromUndefinedOr(ALWAYS[comparison.lengthSide][comparison.operator]),
    () =>
      Boolean.every([
        comparison.againstZero,
        comparison.referenceReceiver,
        comparison.strictNullChecks,
        receiverIsCollection(comparison.receiver),
      ]),
  )

const keptLiteralAt = (site: MutantSite, index: number, always: boolean): boolean =>
  Arr.some(
    site.candidates,
    (sibling, siblingIndex) =>
      Boolean.every([siblingIndex !== index, sibling.kept, Option.contains(sibling.literal, always)]),
  )

const culledOf = (site: MutantSite, candidate: SiteCandidate, index: number): Option.Option<CollectionSizeDecision> =>
  Option.map(
    Option.filter(
      Option.flatMap(Option.filter(candidate.comparison, () => candidate.kept), constantOf),
      (always) => keptLiteralAt(site, index, always),
    ),
    (always) => CollectionSizeDecision.make({ id: candidate.id, always }),
  )

export const classifyCollectionSize = Workflow.make({
  command: ClassifyCollectionSizeCommand,
  decision: S.Array(CollectionSizeDecision),
  error: S.Never,
  decide: (command): Result.Result<ReadonlyArray<CollectionSizeDecision>, never> =>
    Result.succeed(
      Arr.flatMap(
        command.sites,
        (site) => Arr.getSomes(Arr.map(site.candidates, (candidate, index) => culledOf(site, candidate, index))),
      ),
    ),
})
