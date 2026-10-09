import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const RequireDryRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RequireDryRun')
type RequireDryRunTypeId = typeof RequireDryRunTypeId

const COMPILE_ERROR = 'CompileError'

export const PriorStatus = S.Struct({ mutantId: S.String, status: S.String })
export type PriorStatus = typeof PriorStatus.Type

export class RequireDryRunCommand extends S.TaggedClass<RequireDryRunCommand>()('RequireDryRunCommand', {
  dryRunOnly: S.Boolean,
  ignoreStatic: S.Boolean,
  hasCheckers: S.Boolean,
  mutantIds: S.Array(S.String),
  priorStatuses: S.Array(PriorStatus),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DryRunNeeded extends S.TaggedClass<DryRunNeeded>()('DryRunNeeded', {
  dependentMutantIds: S.Array(S.String),
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
  Boolean.and(statuses.length > 0, statuses.every((prior) => prior.status === COMPILE_ERROR))

const coverageFreeVerdictsPossible = (command: RequireDryRunCommand): boolean =>
  Boolean.and(
    command.hasCheckers,
    Boolean.not(Boolean.or(command.dryRunOnly, command.ignoreStatic)),
  )

const dependentMutantIdsOf = (command: RequireDryRunCommand): readonly string[] => {
  const byId = statusesById(command)
  return Boolean.match(coverageFreeVerdictsPossible(command), {
    onTrue: () =>
      command.mutantIds.filter((mutantId) =>
        Record.get(byId, mutantId).pipe(
          Option.getOrElse((): readonly PriorStatus[] => []),
          settledByTheChecker,
          Boolean.not,
        )
      ),
    onFalse: () => command.mutantIds,
  })
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
