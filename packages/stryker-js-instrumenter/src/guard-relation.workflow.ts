import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
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
  alternate: S.optional(Mutant.Location),
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
  readonly guard: Mutant.Guard
}

const locationKeyOf = (location: Mutant.Location): string =>
  `${location.start.line}:${location.start.column}:${location.end.line}:${location.end.column}`

type BlockMutantIndex = Readonly<Record<string, Mutant.MutantId | undefined>>

const emptyBlockMutantIndex: BlockMutantIndex = {}

const blockMutantIndex = (mutants: readonly GuardMutant[]): BlockMutantIndex =>
  Arr.reduce(
    Arr.filter(mutants, (mutant) => mutant.mutatorName === BLOCK_MUTATOR),
    emptyBlockMutantIndex,
    (index, mutant) =>
      Option.match(Option.fromNullishOr(index[locationKeyOf(mutant.location)]), {
        onNone: () => ({ ...index, [locationKeyOf(mutant.location)]: mutant.id }),
        onSome: () => index,
      }),
  )

const insideOf = (
  block: Mutant.Location,
  blockMutantId: Mutant.MutantId,
  mutants: readonly GuardMutant[],
): readonly Mutant.MutantId[] =>
  Arr.filter(
    mutants,
    (mutant) => [contains(block, mutant.location), mutant.id !== blockMutantId].every(Boolean),
  ).map((mutant) => mutant.id)

const alternateFieldOf = (alternate: Option.Option<Mutant.MutantId>): { readonly alternate?: Mutant.MutantId } =>
  Option.match(alternate, { onNone: () => ({}), onSome: (present) => ({ alternate: present }) })

const blockMutantAt = (blockMutants: BlockMutantIndex, location: Mutant.Location): Option.Option<Mutant.MutantId> =>
  Option.fromNullishOr(blockMutants[locationKeyOf(location)])

const alternateOf = (
  site: GuardSite,
  blockMutants: BlockMutantIndex,
): Option.Option<Option.Option<Mutant.MutantId>> =>
  Option.match(Option.fromUndefinedOr(site.alternate), {
    onNone: () => Option.some(Option.none()),
    onSome: (alternate) => Option.map(blockMutantAt(blockMutants, alternate), Option.some),
  })

const resolvedSites = (command: GuardRelationCommand): readonly ResolvedSite[] => {
  const blockMutants = blockMutantIndex(command.mutants)
  return command.sites.flatMap((site) =>
    Option.toArray(
      Option.map(
        Option.all({
          blockMutantId: blockMutantAt(blockMutants, site.block),
          alternateMutantId: alternateOf(site, blockMutants),
        }),
        ({ blockMutantId, alternateMutantId }): ResolvedSite => ({
          test: site.test,
          guard: {
            block: blockMutantId,
            inside: insideOf(site.block, blockMutantId, command.mutants),
            ...alternateFieldOf(alternateMutantId),
          },
        }),
      ),
    )
  )
}

const ownerOf = (sites: readonly ResolvedSite[], location: Mutant.Location): Option.Option<ResolvedSite> =>
  Arr.reduce(
    sites,
    Option.none<ResolvedSite>(),
    (best, site) =>
      Bool.match(contains(site.test, location), {
        onTrue: () =>
          Option.match(best, {
            onNone: () => Option.some(site),
            onSome: (current) =>
              Bool.match(Order.isLessThan(testOrder)(site.test, current.test), {
                onTrue: () => Option.some(site),
                onFalse: () => best,
              }),
          }),
        onFalse: () => best,
      }),
  )

const decisionFor = (sites: readonly ResolvedSite[], mutant: GuardMutant): GuardRelationDecision =>
  Option.match(ownerOf(sites, mutant.location), {
    onNone: () => Guardless.make({ id: mutant.id }),
    onSome: (site) => GuardedByBlock.make({ id: mutant.id, guard: site.guard }),
  })

const decisionsUnderDefault = (command: GuardRelationCommand): readonly GuardRelationDecision[] => {
  const sites = resolvedSites(command)
  return command.mutants.map((mutant) => decisionFor(sites, mutant))
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
    Result.succeed(decisionsOf(command)),
})
