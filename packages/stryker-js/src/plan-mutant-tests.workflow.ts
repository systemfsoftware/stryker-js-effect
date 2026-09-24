import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, MutantStatusSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutantTestPlanCommand } from './MutantTestPlanCommand.schema.js'
import { PlannedMutantRunOptions } from './MutantTestPlan.schema.js'

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantPlan')
type MutantPlanTypeId = typeof MutantPlanTypeId

export class PlannedRunMutant extends S.TaggedClass<PlannedRunMutant>()('PlannedRunMutant', {
  mutantId: S.NonEmptyString,
  netTime: S.Finite,
  runOptions: PlannedMutantRunOptions,
  static: S.optional(S.Boolean),
  coveredBy: S.optional(S.Array(S.String)),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class PlannedEarlyResultMutant extends S.TaggedClass<PlannedEarlyResultMutant>()('PlannedEarlyResultMutant', {
  mutantId: S.NonEmptyString,
  status: MutantStatusSchema,
  statusReason: S.optional(S.String),
  static: S.optional(S.Boolean),
  coveredBy: S.optional(S.Array(S.String)),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class CoveredMutantHitCountMissing extends S.TaggedError<CoveredMutantHitCountMissing>()(
  'CoveredMutantHitCountMissing',
  { missingIds: S.Array(S.String) },
) {}

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
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => ({} as const),
    onSome: (present) => ({ testFilter: [...present] } as const),
  })

const staticCoverageCountOf = (staticCoverage: Record<string, number> | undefined, mutantId: string) =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(staticCoverage),
      (countsByMutantId) => Option.fromUndefinedOr(countsByMutantId[mutantId]),
    ),
    () => 0,
  )

const hasCoverageForPlan = (staticCoverage: Record<string, number> | undefined) =>
  Option.match(Option.fromUndefinedOr(staticCoverage), {
    onNone: () => false,
    onSome: (coverage) => Object.keys(coverage).length > 0,
  })

const mutantIsStatic = (command: MutantTestPlanCommand, mutantId: string) =>
  staticCoverageCountOf(command.staticCoverage, mutantId) > 0

const calculateTotalTimeForIds = (testIds: readonly string[], testTimeById: Record<string, number>) =>
  testIds.reduce(
    (netTime, testId) => netTime + Option.getOrElse(Option.fromUndefinedOr(testTimeById[testId]), () => 0),
    0,
  )

const hitLimitForCount = (hitCount: number) => hitCount * 100

const hitLimitOf = (hitCount: number | undefined) => Option.map(Option.fromUndefinedOr(hitCount), hitLimitForCount)

const mutantActivationOf = (testFilter: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => 'static' as const,
    onSome: () => 'runtime' as const,
  })

const coveredByOfMutant = (mutant: Mutant) =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(mutant.coveredBy), (coveredBy) => [...coveredBy]))

const reloadEnvironmentOf = (testFilter: readonly string[] | undefined, isStatic: boolean | undefined) =>
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => true,
    onSome: () => Option.match(Option.fromUndefinedOr(isStatic), {
      onNone: () => true,
      onSome: (flag) => flag,
    }),
  })

const toRunPlan = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
  netTime: number,
  testFilter: readonly string[] | undefined,
  isStatic: boolean | undefined,
  coveredBy: readonly string[] | undefined,
) =>
  PlannedRunMutant.make({
    mutantId: mutant.id,
    netTime,
    runOptions: {
      mutantActivation: mutantActivationOf(testFilter),
      timeout: command.options.timeoutFactor * netTime + command.options.timeoutMS + command.timeOverheadMS,
      sandboxFileName: Option.getOrElse(
        Option.fromUndefinedOr(command.sandboxFileByName[mutant.fileName]),
        () => mutant.fileName,
      ),
      disableBail: command.options.disableBail,
      reloadEnvironment: reloadEnvironmentOf(testFilter, isStatic),
      ...testFilterField(testFilter),
      ...Option.match(hitLimitOf(command.hitsByMutantId[mutant.id]), {
        onNone: () => ({} as const),
        onSome: (hitLimit) => ({ hitLimit } as const),
      }),
    },
    ...staticField(isStatic),
    ...coveredByField(coveredBy),
  })

const toEarlyResultPlan = (
  mutant: Mutant,
  isStatic: boolean | undefined,
  status: MutantStatus,
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
  mutant: Mutant,
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
  mutant: Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
  coveredBy: readonly string[],
) =>
  Boolean.match(command.options.ignoreStatic, {
    onTrue: () => toEarlyResultPlan(mutant, isStatic, 'Ignored', IGNORED_STATIC_MUTANT_REASON, coveredBy),
    onFalse: () =>
      toRunPlan(mutant, command, command.timeSpentAllTests, command.globalTestFilter, isStatic, coveredBy),
  })

const planForStaticallyCovered = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
) => {
  const tests = Option.getOrElse(Option.fromUndefinedOr(command.testsByMutantId[mutant.id]), () => [])
  const coveredBy = [...tests]
  const useCovered = Boolean.match(isStatic, {
    onTrue: () => command.options.ignoreStatic && tests.length > 0,
    onFalse: () => true,
  })
  return Boolean.match(useCovered, {
    onTrue: () => runWithCoveredTests(mutant, command, isStatic, tests, coveredBy),
    onFalse: () => planForUncoveredStatic(mutant, command, isStatic, coveredBy),
  })
}

const mutantIsCovered = (command: MutantTestPlanCommand, mutantId: string) =>
  Option.match(Option.fromUndefinedOr(command.testsByMutantId[mutantId]), {
    onNone: () => mutantIsStatic(command, mutantId),
    onSome: (tests) => tests.length > 0 || mutantIsStatic(command, mutantId),
  })

const mutantHitCountKnown = (command: MutantTestPlanCommand, mutant: Mutant) =>
  Option.match(Option.fromUndefinedOr(command.hitsByMutantId[mutant.id]), {
    onNone: () => Boolean.match(mutantIsCovered(command, mutant.id), {
      onTrue: () => Option.fromUndefinedOr(command.staticCoverage),
      onFalse: () => Option.some(undefined),
    }),
    onSome: () => Option.some(undefined),
  })

const decidePlanForMutant = (mutant: Mutant, command: MutantTestPlanCommand): MutantPlanDecision => {
  const isStatic = mutantIsStatic(command, mutant.id)
  return Option.match(Option.fromUndefinedOr(mutant.status), {
    onSome: (status) => toEarlyResultPlan(mutant, isStatic, status, mutant.statusReason, coveredByOfMutant(mutant)),
    onNone: () =>
      Option.match(Option.fromUndefinedOr(command.staticCoverage), {
        onNone: () =>
          toRunPlan(
            mutant,
            command,
            command.timeSpentAllTests,
            testFilterOf(command.globalTestFilter),
            undefined,
            undefined,
          ),
        onSome: () => planForStaticallyCovered(mutant, command, isStatic),
      }),
  })
}

const isClosedMutant = (mutant: Mutant) => Option.isSome(Option.fromUndefinedOr(mutant.status))

const openMutantsOf = (mutants: ReadonlyArray<Mutant>) => mutants.filter((mutant) => !isClosedMutant(mutant))

const missingHitCountIds = (command: MutantTestPlanCommand) =>
  openMutantsOf(command.mutants).flatMap((mutant) =>
    Option.match(mutantHitCountKnown(command, mutant), {
      onNone: () => [mutant.id] as const,
      onSome: () => [] as const,
    }))

const plannedMutantsOf = (command: MutantTestPlanCommand) =>
  command.mutants.map((mutant) => decidePlanForMutant(mutant, command))

const decide = (
  command: MutantTestPlanCommand,
): Result.Result<ReadonlyArray<MutantPlanDecision>, CoveredMutantHitCountMissing> =>
  Option.match(Option.fromUndefinedOr(missingHitCountIds(command)[0]), {
    onNone: () => Result.succeed(plannedMutantsOf(command)),
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
  error: CoveredMutantHitCountMissing,
  decide,
})
