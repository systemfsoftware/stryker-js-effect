import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlannedMutantRunOptions } from './MutantTestPlan.schema.js'
import { MutantTestPlanCommand } from './MutantTestPlanCommand.schema.js'

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantPlan')
type MutantPlanTypeId = typeof MutantPlanTypeId

export class PlannedRunMutant extends S.TaggedClass<PlannedRunMutant>()('PlannedRunMutant', {
  mutantId: Mutant.MutantId,
  netTime: S.Finite,
  runOptions: PlannedMutantRunOptions,
  static: S.optional(S.Boolean),
  coveredBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class PlannedEarlyResultMutant extends S.TaggedClass<PlannedEarlyResultMutant>()('PlannedEarlyResultMutant', {
  mutantId: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  statusReason: S.optional(S.String),
  static: S.optional(S.Boolean),
  coveredBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class CoveredMutantHitCountMissing extends S.TaggedError<CoveredMutantHitCountMissing>()(
  'CoveredMutantHitCountMissing',
  { missingIds: S.Array(S.String) },
) {
  override get message(): string {
    return `Hit count missing for covered mutants: ${this.missingIds.join(', ')}`
  }
}

export class MutantTimeoutNotFinite extends S.TaggedError<MutantTimeoutNotFinite>()('MutantTimeoutNotFinite', {
  mutantId: Mutant.MutantId,
}) {
  override get message(): string {
    return `Computed test timeout for mutant ${this.mutantId} is not finite`
  }
}

const firstDefined = <Value>(first: Value | undefined, second: Value | undefined) =>
  Option.getOrElse(Option.fromNullishOr(first), () => second)

const staticField = (isStatic: boolean | undefined) =>
  Option.match(Option.fromUndefinedOr(isStatic), {
    onNone: () => ({} as const),
    onSome: (present) => ({ static: present } as const),
  })

const coveredByField = (coveredBy: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(coveredBy), {
    onNone: () => ({} as const),
    onSome: (present) => ({ coveredBy: [...present] } as const),
  })

const testFilterField = (testFilter: readonly string[] | undefined) =>
  Option.match(Option.filter(Option.fromUndefinedOr(testFilter), (filter) => filter.length > 0), {
    onNone: () => ({} as const),
    onSome: (present) => ({ testFilter: [...present] } as const),
  })

const staticCoverageCountOf = (staticCoverage: Record<string, number> | undefined, mutantId: string) =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(staticCoverage),
      (countsByMutantId) => Record.get(countsByMutantId, mutantId),
    ),
    () => 0,
  )

const hasCoverageForPlan = (staticCoverage: Record<string, number> | undefined): boolean =>
  Option.isSome(Option.fromUndefinedOr(staticCoverage))

const mutantIsStatic = (command: MutantTestPlanCommand, mutantId: Mutant.MutantId) =>
  staticCoverageCountOf(command.staticCoverage, mutantId) > 0

const calculateTotalTimeForIds = (testIds: readonly string[], testTimeById: Record<string, number>) =>
  testIds.reduce(
    (netTime, testId) => netTime + Option.getOrElse(Record.get(testTimeById, testId), () => 0),
    0,
  )

const hitLimitForCount = (hitCount: number) => hitCount * 100

const hitLimitOf = (hitCount: Option.Option<number>) => Option.map(hitCount, hitLimitForCount)

const mutantActivationOf = (testFilter: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => 'static' as const,
    onSome: () => 'runtime' as const,
  })

const coveredByOfMutant = (mutant: Mutant.Mutant) =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(mutant.coveredBy), (coveredBy) => [...coveredBy]))

const reloadEnvironmentOf = (testFilter: readonly string[] | undefined, isStatic: boolean | undefined) =>
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => true,
    onSome: () =>
      Option.match(Option.fromUndefinedOr(isStatic), {
        onNone: () => true,
        onSome: (flag) => flag,
      }),
  })

const toRunPlan = (
  mutant: Mutant.Mutant,
  command: MutantTestPlanCommand,
  netTime: number,
  testFilter: readonly string[] | undefined,
  isStatic: boolean | undefined,
  coveredBy: readonly string[] | undefined,
): Result.Result<PlannedRunMutant, MutantTimeoutNotFinite> => {
  const timeout = command.options.timeoutFactor * netTime + command.options.timeoutMS + command.timeOverheadMS
  return Boolean.match(Number.isFinite(timeout), {
    onTrue: () =>
      Result.succeed(PlannedRunMutant.make({
        mutantId: mutant.id,
        netTime,
        runOptions: {
          mutantActivation: mutantActivationOf(testFilter),
          timeout,
          sandboxFileName: Option.getOrElse(
            Record.get(command.sandboxFileByName, mutant.fileName),
            () => mutant.fileName,
          ),
          disableBail: command.options.disableBail,
          reloadEnvironment: reloadEnvironmentOf(testFilter, isStatic),
          ...testFilterField(testFilter),
          ...Option.match(hitLimitOf(Record.get(command.hitsByMutantId, mutant.id)), {
            onNone: () => ({} as const),
            onSome: (hitLimit) => ({ hitLimit } as const),
          }),
        },
        ...staticField(isStatic),
        ...coveredByField(coveredBy),
      })),
    onFalse: () => Result.fail(MutantTimeoutNotFinite.make({ mutantId: mutant.id })),
  })
}

const toEarlyResultPlan = (
  mutant: Mutant.Mutant,
  isStatic: boolean | undefined,
  status: Mutant.MutantStatus,
  statusReason: string | undefined,
  coveredBy: readonly string[] | undefined,
) =>
  PlannedEarlyResultMutant.make({
    mutantId: mutant.id,
    status,
    ...Option.match(Option.fromUndefinedOr(firstDefined(statusReason, mutant.statusReason)), {
      onNone: () => ({} as const),
      onSome: (reason) => ({ statusReason: reason } as const),
    }),
    ...staticField(isStatic),
    ...coveredByField(coveredBy),
  })

const IGNORED_STATIC_MUTANT_REASON = 'Static mutant (and "ignoreStatic" was enabled)' as const

const runWithCoveredTests = (
  mutant: Mutant.Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
  tests: readonly string[],
  coveredBy: readonly string[],
) =>
  toRunPlan(
    mutant,
    command,
    calculateTotalTimeForIds(tests, command.testTimeById),
    coveredBy,
    isStatic,
    coveredBy,
  )

const planForUncoveredStatic = (
  mutant: Mutant.Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
  coveredBy: readonly string[],
) =>
  Boolean.match(command.options.ignoreStatic, {
    onTrue: () =>
      Result.succeed(toEarlyResultPlan(mutant, isStatic, 'Ignored', IGNORED_STATIC_MUTANT_REASON, coveredBy)),
    onFalse: () => toRunPlan(mutant, command, command.timeSpentAllTests, command.globalTestFilter, isStatic, coveredBy),
  })

const planForStaticallyCovered = (
  mutant: Mutant.Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
) => {
  const tests = Option.getOrElse(Record.get(command.testsByMutantId, mutant.id), (): readonly string[] => [])
  const coveredBy = [...tests]
  const useCovered = Boolean.match(isStatic, {
    onTrue: () => Boolean.and(command.options.ignoreStatic, tests.length > 0),
    onFalse: () => true,
  })
  return Boolean.match(useCovered, {
    onTrue: () => runWithCoveredTests(mutant, command, isStatic, tests, coveredBy),
    onFalse: () => planForUncoveredStatic(mutant, command, isStatic, coveredBy),
  })
}

const mutantIsCovered = (command: MutantTestPlanCommand, mutantId: Mutant.MutantId) =>
  Option.match(Record.get(command.testsByMutantId, mutantId), {
    onNone: () => mutantIsStatic(command, mutantId),
    onSome: (tests) => Boolean.or(tests.length > 0, mutantIsStatic(command, mutantId)),
  })

const decidePlanForMutant = (
  mutant: Mutant.Mutant,
  command: MutantTestPlanCommand,
): Result.Result<PlannedEarlyResultMutant | PlannedRunMutant, MutantTimeoutNotFinite> => {
  const isStatic = mutantIsStatic(command, mutant.id)
  return Option.match(Option.fromUndefinedOr(mutant.status), {
    onSome: (status) =>
      Result.succeed(toEarlyResultPlan(mutant, isStatic, status, mutant.statusReason, coveredByOfMutant(mutant))),
    onNone: () =>
      Boolean.match(hasCoverageForPlan(command.staticCoverage), {
        onTrue: () => planForStaticallyCovered(mutant, command, isStatic),
        onFalse: () =>
          toRunPlan(mutant, command, command.timeSpentAllTests, command.globalTestFilter, undefined, undefined),
      }),
  })
}

const isClosedMutant = (mutant: Mutant.Mutant) => Option.isSome(Option.fromUndefinedOr(mutant.status))

const openMutantsOf = (mutants: ReadonlyArray<Mutant.Mutant>) => mutants.filter((mutant) => !isClosedMutant(mutant))

const hitCountRequiredAndAbsent = (command: MutantTestPlanCommand, mutant: Mutant.Mutant) =>
  Boolean.every([
    mutantIsCovered(command, mutant.id),
    Predicate.isNotUndefined(command.staticCoverage),
    Option.isNone(Record.get(command.hitsByMutantId, mutant.id)),
  ])

const missingHitCountIds = (command: MutantTestPlanCommand) =>
  openMutantsOf(command.mutants).flatMap((mutant) =>
    Boolean.match(hitCountRequiredAndAbsent(command, mutant), {
      onTrue: () => [mutant.id] as const,
      onFalse: () => [] as const,
    })
  )

const plannedMutantsOf = (command: MutantTestPlanCommand) =>
  command.mutants.reduce<
    Result.Result<ReadonlyArray<PlannedRunMutant | PlannedEarlyResultMutant>, MutantTimeoutNotFinite>
  >(
    (planned, mutant) =>
      Result.flatMap(planned, (soFar) => Result.map(decidePlanForMutant(mutant, command), (next) => [...soFar, next])),
    Result.succeed([]),
  )

const decide = (
  command: MutantTestPlanCommand,
): Result.Result<
  ReadonlyArray<PlannedEarlyResultMutant | PlannedRunMutant>,
  CoveredMutantHitCountMissing | MutantTimeoutNotFinite
> =>
  Option.match(Option.fromUndefinedOr(missingHitCountIds(command)[0]), {
    onNone: () => plannedMutantsOf(command),
    onSome: (first) =>
      Result.fail(
        CoveredMutantHitCountMissing.make({
          missingIds: [first, ...missingHitCountIds(command).slice(1)],
        }),
      ),
  })
export const planMutantTests = Workflow.make({
  command: MutantTestPlanCommand,
  decision: S.Array(S.Union([PlannedRunMutant, PlannedEarlyResultMutant])),
  error: S.Union([CoveredMutantHitCountMissing, MutantTimeoutNotFinite]),
  decide,
})
