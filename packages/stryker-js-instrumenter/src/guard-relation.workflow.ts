import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutatorNameSchema } from './directives/directive.schema.js'

const BLOCK_MUTATOR = 'BlockStatement'

export const GuardSiteSchema = S.Struct({
  test: Mutant.Location,
  block: Mutant.Location,
})
export type GuardSite = typeof GuardSiteSchema.Type

export const GuardMutantSchema = S.Struct({
  id: Mutant.MutantId,
  mutatorName: MutatorNameSchema,
  location: Mutant.Location,
})
export type GuardMutant = typeof GuardMutantSchema.Type

export class GuardRelationCommand extends S.TaggedClass<GuardRelationCommand>()('GuardRelationCommand', {
  policy: Options.MutantSetPolicy,
  sites: S.Array(GuardSiteSchema),
  mutants: S.Array(GuardMutantSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const GuardRelationDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/GuardRelationDecision',
)
type GuardRelationDecisionTypeId = typeof GuardRelationDecisionTypeId

export class GuardedByBlock extends S.TaggedClass<GuardedByBlock>()('GuardedByBlock', {
  id: Mutant.MutantId,
  guard: Mutant.Guard,
}) {
  readonly [GuardRelationDecisionTypeId] = GuardRelationDecisionTypeId
}

export class Guardless extends S.TaggedClass<Guardless>()('Guardless', {
  id: Mutant.MutantId,
}) {
  readonly [GuardRelationDecisionTypeId] = GuardRelationDecisionTypeId
}

export const GuardRelationDecision = S.Union([GuardedByBlock, Guardless])
export type GuardRelationDecision = typeof GuardRelationDecision.Type
export const GuardRelationDecisions = S.Array(GuardRelationDecision)

const positionOrder: Order.Order<Mutant.Position> = Order.combine(
  Order.mapInput(Order.Number, (position: Mutant.Position) => position.line),
  Order.mapInput(Order.Number, (position: Mutant.Position) => position.column),
)

const atOrBefore = Order.isLessThanOrEqualTo(positionOrder)

const contains = (outer: Mutant.Location, inner: Mutant.Location): boolean =>
  [atOrBefore(outer.start, inner.start), atOrBefore(inner.end, outer.end)].every(Boolean)

const sameLocation = (left: Mutant.Location, right: Mutant.Location): boolean =>
  [
    atOrBefore(left.start, right.start),
    atOrBefore(right.start, left.start),
    atOrBefore(left.end, right.end),
    atOrBefore(right.end, left.end),
  ].every(Boolean)

const spanSizeOrder: Order.Order<Mutant.Location> = Order.combine(
  Order.mapInput(Order.Number, (location: Mutant.Location) => location.end.line - location.start.line),
  Order.mapInput(Order.Number, (location: Mutant.Location) => location.end.column - location.start.column),
)

const testOrder: Order.Order<Mutant.Location> = Order.combine(
  spanSizeOrder,
  Order.mapInput(positionOrder, (location: Mutant.Location) => location.start),
)

interface ResolvedSite {
  readonly test: Mutant.Location
  readonly block: Mutant.Location
  readonly blockMutantId: Mutant.MutantId
}

const blockMutantOf = (site: GuardSite, mutants: readonly GuardMutant[]): Option.Option<GuardMutant> =>
  Arr.findFirst(
    mutants,
    (mutant) => [mutant.mutatorName === BLOCK_MUTATOR, sameLocation(mutant.location, site.block)].every(Boolean),
  )

const resolvedSites = (command: GuardRelationCommand): readonly ResolvedSite[] =>
  command.sites.flatMap((site) =>
    Option.toArray(
      Option.map(blockMutantOf(site, command.mutants), (mutant): ResolvedSite => ({
        test: site.test,
        block: site.block,
        blockMutantId: mutant.id,
      })),
    )
  )

const ownerOf = (sites: readonly ResolvedSite[], location: Mutant.Location): Option.Option<ResolvedSite> =>
  Arr.head(Arr.sortWith(Arr.filter(sites, (site) => contains(site.test, location)), (site) => site.test, testOrder))

const insideOf = (site: ResolvedSite, mutants: readonly GuardMutant[]): readonly Mutant.MutantId[] =>
  Arr.filter(
    mutants,
    (mutant) => [contains(site.block, mutant.location), mutant.id !== site.blockMutantId].every(Boolean),
  ).map((mutant) => mutant.id)

const decisionFor = (
  sites: readonly ResolvedSite[],
  mutants: readonly GuardMutant[],
  mutant: GuardMutant,
): GuardRelationDecision =>
  Option.match(ownerOf(sites, mutant.location), {
    onNone: () => Guardless.make({ id: mutant.id }),
    onSome: (site) =>
      GuardedByBlock.make({
        id: mutant.id,
        guard: { block: site.blockMutantId, inside: [...insideOf(site, mutants)] },
      }),
  })

const decisionsUnderDefault = (command: GuardRelationCommand): readonly GuardRelationDecision[] => {
  const sites = resolvedSites(command)
  return command.mutants.map((mutant) => decisionFor(sites, command.mutants, mutant))
}

const decisionsOf = (command: GuardRelationCommand): readonly GuardRelationDecision[] =>
  Match.value(command.policy).pipe(
    Match.when('full', () => command.mutants.map((mutant) => Guardless.make({ id: mutant.id }))),
    Match.when('default', () => decisionsUnderDefault(command)),
    Match.exhaustive,
  )

export const guardRelation = Workflow.make({
  command: GuardRelationCommand,
  decision: GuardRelationDecisions,
  error: S.Never,
  decide: (command: GuardRelationCommand): Result.Result<readonly GuardRelationDecision[], never> =>
    Result.succeed([...decisionsOf(command)]),
})
