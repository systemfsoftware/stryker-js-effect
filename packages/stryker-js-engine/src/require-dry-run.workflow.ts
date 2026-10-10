import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const RequireDryRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RequireDryRun')
type RequireDryRunTypeId = typeof RequireDryRunTypeId

export const PriorStatus = S.Struct({ mutantId: Mutant.MutantId, status: Mutant.MutantStatusSchema })
export type PriorStatus = typeof PriorStatus.Type

export const DryRunCandidate = S.Struct({ id: Mutant.MutantId, static: S.Boolean })
export type DryRunCandidate = typeof DryRunCandidate.Type

export class RequireDryRunCommand extends S.TaggedClass<RequireDryRunCommand>()('RequireDryRunCommand', {
  dryRunOnly: S.Boolean,
  ignoreStatic: S.Boolean,
  hasCheckers: S.Boolean,
  mutants: S.Array(DryRunCandidate),
  priorStatuses: S.Array(PriorStatus),
  priorFlakyMutantIds: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DryRunNeeded extends S.TaggedClass<DryRunNeeded>()('DryRunNeeded', {
  dependentMutantIds: S.Array(Mutant.MutantId),
}) {
  readonly [RequireDryRunTypeId] = RequireDryRunTypeId
}

export class DryRunSkippable extends S.TaggedClass<DryRunSkippable>()('DryRunSkippable', {}) {
  readonly [RequireDryRunTypeId] = RequireDryRunTypeId
}

export const RequireDryRunDecision = S.Union([DryRunNeeded, DryRunSkippable])
export type RequireDryRunDecision = typeof RequireDryRunDecision.Type

const statusesById = (command: RequireDryRunCommand): Record.ReadonlyRecord<string, readonly PriorStatus[]> =>
  Arr.groupBy(command.priorStatuses, (prior) => prior.mutantId)

const settledByTheChecker = (statuses: readonly PriorStatus[]): boolean =>
  Boolean.and(statuses.length > 0, statuses.every((prior) => prior.status === 'CompileError'))

const refusedForPriorFlakes = (command: RequireDryRunCommand, mutant: DryRunCandidate): boolean =>
  Boolean.or(
    command.priorFlakyMutantIds.includes(mutant.id),
    Boolean.and(mutant.static, command.priorFlakyMutantIds.length > 0),
  )

const coverageFreeVerdictsPossible = (command: RequireDryRunCommand): boolean =>
  Boolean.and(
    command.hasCheckers,
    Boolean.not(Boolean.or(command.dryRunOnly, command.ignoreStatic)),
  )

const dependsOnTheDryRun = (
  command: RequireDryRunCommand,
  byId: Record.ReadonlyRecord<string, readonly PriorStatus[]>,
  mutant: DryRunCandidate,
): boolean =>
  Boolean.or(
    refusedForPriorFlakes(command, mutant),
    Record.get(byId, mutant.id).pipe(
      Option.getOrElse((): readonly PriorStatus[] => []),
      settledByTheChecker,
      Boolean.not,
    ),
  )

const dependentMutantIdsOf = (command: RequireDryRunCommand): readonly Mutant.MutantId[] => {
  const byId = statusesById(command)
  return Boolean.match(coverageFreeVerdictsPossible(command), {
    onTrue: () => command.mutants.filter((mutant) => dependsOnTheDryRun(command, byId, mutant)),
    onFalse: () => command.mutants,
  }).map((mutant) => mutant.id)
}

const decide = (command: RequireDryRunCommand): Result.Result<RequireDryRunDecision, never> => {
  const dependentMutantIds = dependentMutantIdsOf(command)
  return Boolean.match(Boolean.or(command.dryRunOnly, dependentMutantIds.length > 0), {
    onTrue: () => Result.succeed(DryRunNeeded.make({ dependentMutantIds })),
    onFalse: () => Result.succeed(DryRunSkippable.make({})),
  })
}

export const requireDryRun = Workflow.make({
  command: RequireDryRunCommand,
  decision: RequireDryRunDecision,
  error: S.Never,
  decide,
})
