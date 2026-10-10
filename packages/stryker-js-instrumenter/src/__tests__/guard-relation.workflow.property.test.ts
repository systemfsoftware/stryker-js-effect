import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { guardRelation, GuardRelationCommand, type GuardRelationDecision } from '../guard-relation.workflow.js'

type Command = GuardRelationCommand
type ProbeMutant = Command['mutants'][number]

const idOf = (text: string): Mutant.MutantId => Option.getOrThrow(S.decodeOption(Mutant.MutantId)(text))

const located = (
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): Mutant.Location => ({
  start: { line: startLine, column: startColumn },
  end: { line: endLine, column: endColumn },
})

const TEST_LOC = located(1, 1, 1, 6)
const COND_LOC = located(1, 1, 1, 4)
const BLOCK_LOC = located(2, 1, 4, 1)
const INSIDE_LOC = located(3, 3, 3, 8)

const idAt = (command: Command, index: number, fallback: string): Mutant.MutantId =>
  command.mutants[index]?.id ?? idOf(fallback)

const probeOf = (command: Command, policy: 'default' | 'full' = 'default'): Command =>
  GuardRelationCommand.make({
    policy,
    sites: [{ test: TEST_LOC, block: BLOCK_LOC }],
    mutants: [
      { id: idAt(command, 0, '00000000000000b1'), mutatorName: 'BlockStatement', location: BLOCK_LOC },
      { id: idAt(command, 1, '00000000000000c2'), mutatorName: 'StringLiteral', location: INSIDE_LOC },
      { id: idAt(command, 2, '00000000000000d3'), mutatorName: 'ConditionalExpression', location: COND_LOC },
    ],
  })

const positionOrder: Order.Order<Mutant.Position> = Order.combine(
  Order.mapInput(Order.Number, (position: Mutant.Position) => position.line),
  Order.mapInput(Order.Number, (position: Mutant.Position) => position.column),
)

const spanSizeOrder: Order.Order<Mutant.Location> = Order.combine(
  Order.mapInput(Order.Number, (location: Mutant.Location) => location.end.line - location.start.line),
  Order.mapInput(Order.Number, (location: Mutant.Location) => location.end.column - location.start.column),
)

const testOrder: Order.Order<Mutant.Location> = Order.combine(
  spanSizeOrder,
  Order.mapInput(positionOrder, (location: Mutant.Location) => location.start),
)

interface ModelSite {
  readonly test: Mutant.Location
  readonly block: Mutant.Location
  readonly blockMutantId: Mutant.MutantId
}

type GuardShape = {
  readonly id: Mutant.MutantId
  readonly block: Mutant.MutantId | undefined
  readonly inside: readonly Mutant.MutantId[] | undefined
}

const Geo = {
  contains: (outer: Mutant.Location, inner: Mutant.Location): boolean =>
    [
      Order.isLessThanOrEqualTo(positionOrder)(outer.start, inner.start),
      Order.isLessThanOrEqualTo(positionOrder)(inner.end, outer.end),
    ].every(Boolean),
  sameLocation: (left: Mutant.Location, right: Mutant.Location): boolean =>
    [
      Order.isLessThanOrEqualTo(positionOrder)(left.start, right.start),
      Order.isLessThanOrEqualTo(positionOrder)(right.start, left.start),
      Order.isLessThanOrEqualTo(positionOrder)(left.end, right.end),
      Order.isLessThanOrEqualTo(positionOrder)(right.end, left.end),
    ].every(Boolean),
  guardless: (decision: GuardRelationDecision): boolean =>
    Match.value(decision).pipe(
      Match.tag('GuardedByBlock', () => false),
      Match.tag('Guardless', () => true),
      Match.exhaustive,
    ),
  shapeOf: (decision: GuardRelationDecision): GuardShape =>
    Match.value(decision).pipe(
      Match.tag('GuardedByBlock', (guarded): GuardShape => ({
        id: guarded.id,
        block: guarded.guard.block,
        inside: guarded.guard.inside,
      })),
      Match.tag('Guardless', (guardless): GuardShape => ({
        id: guardless.id,
        block: undefined,
        inside: undefined,
      })),
      Match.exhaustive,
    ),
  blockLocation: (mutants: readonly ProbeMutant[], blockId: Mutant.MutantId): Mutant.Location | undefined =>
    mutants.find((mutant) => mutant.mutatorName === 'BlockStatement' && mutant.id === blockId)?.location,
  modelSites: (command: Command): readonly ModelSite[] =>
    command.sites.flatMap((site) => {
      const block = command.mutants.find((mutant) =>
        mutant.mutatorName === 'BlockStatement' && Geo.sameLocation(mutant.location, site.block)
      )
      return block === undefined ? [] : [{ test: site.test, block: site.block, blockMutantId: block.id }]
    }),
  modelOwner: (sites: readonly ModelSite[], location: Mutant.Location): ModelSite | undefined =>
    sites
      .filter((site) => Geo.contains(site.test, location))
      .toSorted((left, right) => testOrder(left.test, right.test))[0],
  modelInside: (site: ModelSite, mutants: readonly ProbeMutant[]): readonly Mutant.MutantId[] =>
    mutants
      .filter((mutant) => Geo.contains(site.block, mutant.location) && mutant.id !== site.blockMutantId)
      .map((mutant) => mutant.id),
  modelGuard: (command: Command, mutant: ProbeMutant): Mutant.Guard | undefined => {
    const owner = Geo.modelOwner(Geo.modelSites(command), mutant.location)
    return owner === undefined
      ? undefined
      : { block: owner.blockMutantId, inside: [...Geo.modelInside(owner, command.mutants)] }
  },
}

const decisionsOf = (
  decided: Result.Result<readonly GuardRelationDecision[], never>,
): readonly GuardRelationDecision[] => Result.getOrElse(decided, () => [])

const withPolicy = (command: Command, policy: 'default' | 'full'): Command =>
  GuardRelationCommand.make({ policy, sites: [...command.sites], mutants: [...command.mutants] })

const withoutBlockMutants = (command: Command): Command =>
  GuardRelationCommand.make({
    policy: command.policy,
    sites: [...command.sites],
    mutants: command.mutants.filter((mutant) => mutant.mutatorName !== 'BlockStatement'),
  })

describe('guardRelation', () => {
  it.prop(
    '∀c_Command_≡AGuardedMutantsLocationSitsInItsSitesTestAndItsBlockNamesTheBlockMutant',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => {
      const probe = probeOf(command)
      const decisions = decisionsOf(subject(probe))
      return decisions.length === probe.mutants.length &&
        decisions.every((decision, index) => {
          const mutant = probe.mutants[index]
          return mutant !== undefined &&
            Match.value(decision).pipe(
              Match.tag(
                'GuardedByBlock',
                (guarded) =>
                  probe.sites.some((site) =>
                    Geo.contains(site.test, mutant.location) &&
                    probe.mutants.some((candidate) =>
                      candidate.mutatorName === 'BlockStatement' &&
                      candidate.id === guarded.guard.block &&
                      Geo.sameLocation(candidate.location, site.block)
                    )
                  ),
              ),
              Match.tag('Guardless', () => true),
              Match.exhaustive,
            )
        })
    },
  )

  it.prop(
    '∀c_Command_≡EveryInsideIdSitsInsideTheBlockAndIsNotTheBlock',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => {
      const probe = probeOf(command)
      return decisionsOf(subject(probe)).every((decision, index) => {
        const mutant = probe.mutants[index]
        return mutant !== undefined &&
          Match.value(decision).pipe(
            Match.tag('GuardedByBlock', (guarded) => {
              const block = Geo.blockLocation(probe.mutants, guarded.guard.block)
              return block !== undefined &&
                guarded.guard.inside.every((id) =>
                  id !== guarded.guard.block &&
                  probe.mutants.some((candidate) => candidate.id === id && Geo.contains(block, candidate.location))
                )
            }),
            Match.tag('Guardless', () => true),
            Match.exhaustive,
          )
      })
    },
  )

  it.prop(
    '∀c_Command_≡AMutantInsideNoTestIsNeverGuarded',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => {
      const probe = probeOf(command)
      const sites = Geo.modelSites(probe)
      return decisionsOf(subject(probe)).every((decision, index) => {
        const mutant = probe.mutants[index]
        return mutant !== undefined &&
          (Geo.modelOwner(sites, mutant.location) !== undefined || Geo.guardless(decision))
      })
    },
  )

  it.prop(
    '∀c_Command_≡TheFullPolicyGuardsNothing',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => decisionsOf(subject(withPolicy(command, 'full'))).every(Geo.guardless),
  )

  it.prop(
    '∀c_Command_≡ASiteWithoutABlockStatementMutantGuardsNothing',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => decisionsOf(subject(withoutBlockMutants(command))).every(Geo.guardless),
  )

  it.prop(
    '∀c_Command_≡TheGuardIsTheInnermostSitesBlockAndItsOwnInsideMutants',
    { of: [GuardRelationCommand], subject: guardRelation },
    (subject, [command]) => {
      const probe = probeOf(command)
      const actual = decisionsOf(subject(probe)).map(Geo.shapeOf)
      const expected = probe.mutants.map((mutant): GuardShape => {
        const guard = Geo.modelGuard(probe, mutant)
        return guard === undefined
          ? { id: mutant.id, block: undefined, inside: undefined }
          : { id: mutant.id, block: guard.block, inside: guard.inside }
      })
      return actual.length === expected.length &&
        actual.every((shape, index) => JSON.stringify(shape) === JSON.stringify(expected[index]))
    },
  )
})
