import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RelationalOperator } from './relational-operator.schema.js'

const COMPLEMENT_ROWS: Readonly<
  Record<RelationalOperator, { readonly complement: RelationalOperator; readonly dominator: RelationalOperator }>
> = {
  '<': { complement: '>=', dominator: '<=' },
  '<=': { complement: '>', dominator: '<' },
  '>': { complement: '<=', dominator: '>=' },
  '>=': { complement: '<', dominator: '>' },
}

export class RelationalSite extends S.TaggedClass<RelationalSite>()('RelationalSite', {
  operator: RelationalOperator,
}) {}

export class OtherSite extends S.TaggedClass<OtherSite>()('OtherSite', {}) {}

export const SubsumptionSite = S.Union([RelationalSite, OtherSite])
export type SubsumptionSite = typeof SubsumptionSite.Type

export class OrderingOperator extends S.TaggedClass<OrderingOperator>()('OrderingOperator', {
  operator: RelationalOperator,
}) {}

export class OtherReplacement extends S.TaggedClass<OtherReplacement>()('OtherReplacement', {}) {}

export const SubsumptionReplacement = S.Union([OrderingOperator, OtherReplacement])
export type SubsumptionReplacement = typeof SubsumptionReplacement.Type

export const StaticStatus = S.Literals(['StaticallyKept', 'StaticallyIgnored'])
export type StaticStatus = typeof StaticStatus.Type

export const SubsumptionCandidateSchema = S.Struct({
  id: Mutant.MutantId,
  replacement: SubsumptionReplacement,
  status: StaticStatus,
})
export type SubsumptionCandidate = typeof SubsumptionCandidateSchema.Type

export class SubsumeMutantsCommand extends S.TaggedClass<SubsumeMutantsCommand>()('SubsumeMutantsCommand', {
  policy: Options.MutantSetPolicy,
  site: SubsumptionSite,
  candidates: S.Array(SubsumptionCandidateSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const SubsumptionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/SubsumptionDecision',
)
type SubsumptionDecisionTypeId = typeof SubsumptionDecisionTypeId

export class Unaffected extends S.TaggedClass<Unaffected>()('Unaffected', {}) {
  readonly [SubsumptionDecisionTypeId] = SubsumptionDecisionTypeId
}

export class Subsumed extends S.TaggedClass<Subsumed>()('Subsumed', {
  rule: S.Literal('complement'),
  dominators: S.NonEmptyArray(Mutant.MutantId),
}) {
  readonly [SubsumptionDecisionTypeId] = SubsumptionDecisionTypeId
}

export const SubsumptionDecision = S.Union([Unaffected, Subsumed])
export type SubsumptionDecision = typeof SubsumptionDecision.Type

export const SubsumptionDecisions = S.Array(SubsumptionDecision)

const replacesWith = (candidate: SubsumptionCandidate, operator: RelationalOperator): boolean =>
  Match.value(candidate.replacement).pipe(
    Match.tag('OrderingOperator', (replacement) => replacement.operator === operator),
    Match.tag('OtherReplacement', () => false),
    Match.exhaustive,
  )

const isKeptAs = (candidate: SubsumptionCandidate, operator: RelationalOperator): boolean =>
  [candidate.status === 'StaticallyKept', replacesWith(candidate, operator)].every(Boolean)

const dominatorsOf = (
  candidates: readonly SubsumptionCandidate[],
  operator: RelationalOperator,
): Option.Option<Arr.NonEmptyReadonlyArray<Mutant.MutantId>> =>
  Option.liftPredicate(
    candidates
      .filter((candidate) => isKeptAs(candidate, COMPLEMENT_ROWS[operator].dominator))
      .map((candidate) => candidate.id),
    Arr.isArrayNonEmpty,
  )

const decideAt = (
  candidates: readonly SubsumptionCandidate[],
  operator: RelationalOperator,
) =>
(candidate: SubsumptionCandidate): SubsumptionDecision =>
  Option.match(
    Option.flatMap(
      Option.liftPredicate(candidate, (kept) => isKeptAs(kept, COMPLEMENT_ROWS[operator].complement)),
      () => dominatorsOf(candidates, operator),
    ),
    {
      onNone: (): SubsumptionDecision => Unaffected.make({}),
      onSome: (dominators) => Subsumed.make({ rule: 'complement', dominators }),
    },
  )

const allUnaffected = (command: SubsumeMutantsCommand): readonly SubsumptionDecision[] =>
  command.candidates.map(() => Unaffected.make({}))

const decisionsAtSite = (command: SubsumeMutantsCommand): readonly SubsumptionDecision[] =>
  Match.value(command.site).pipe(
    Match.tag('RelationalSite', (site) => command.candidates.map(decideAt(command.candidates, site.operator))),
    Match.tag('OtherSite', () => allUnaffected(command)),
    Match.exhaustive,
  )

export const subsumeMutants = Workflow.make({
  command: SubsumeMutantsCommand,
  decision: SubsumptionDecisions,
  error: S.Never,
  decide: (command: SubsumeMutantsCommand): Result.Result<readonly SubsumptionDecision[], never> =>
    Result.succeed(
      Match.value(command.policy).pipe(
        Match.when('full', () => allUnaffected(command)),
        Match.when('default', () => decisionsAtSite(command)),
        Match.exhaustive,
      ),
    ),
})
