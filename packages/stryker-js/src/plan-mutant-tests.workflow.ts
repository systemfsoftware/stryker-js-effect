import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, MutantActivationSchema, MutantStatusSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StageError } from './Run.schema.js'

const ZERO = 0
const HIT_LIMIT_FACTOR = 100

export class MutantTestPlanCommand extends S.TaggedClass<MutantTestPlanCommand>()('MutantTestPlanCommand', {
  mutants: S.Array(Mutant),
  timeOverheadMS: S.Finite,
  timeSpentAllTests: S.Finite,
  globalTestFilter: S.optional(S.Array(S.String)),
  hitsByMutantId: S.Record(S.String, S.Finite),
  staticCoverage: S.optional(S.Record(S.String, S.Finite)),
  testsByMutantId: S.Record(S.String, S.Array(S.String)),
  testTimeById: S.Record(S.String, S.Finite),
  options: S.Struct({
    disableBail: S.Boolean,
    timeoutMS: S.Finite,
    timeoutFactor: S.Finite,
    ignoreStatic: S.Boolean,
  }),
  sandboxFileByName: S.Record(S.String, S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    timeOverheadMS: 'stryker.mutant_test_plan.time_overhead_ms',
    timeSpentAllTests: 'stryker.mutant_test_plan.time_spent_all_tests_ms',
  } as const
}

const DecidedRunOptions = S.Struct({
  mutantActivation: MutantActivationSchema,
  timeout: S.Finite,
  sandboxFileName: S.String,
  disableBail: S.Boolean,
  reloadEnvironment: S.Boolean,
  testFilter: S.optional(S.Array(S.String)),
  hitLimit: S.optional(S.Finite),
})

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantPlan')
type MutantPlanTypeId = typeof MutantPlanTypeId

export class PlannedRunMutant extends S.TaggedClass<PlannedRunMutant>()('PlannedRunMutant', {
  mutantId: S.NonEmptyString,
  netTime: S.Finite,
  runOptions: DecidedRunOptions,
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

export type MutantPlanDecision = PlannedRunMutant | PlannedEarlyResultMutant

const firstDefined = <Value>(first: Value | undefined, second: Value | undefined) =>
  Option.getOrElse(Option.fromNullishOr(first), () => second)

const staticField = (isStatic: boolean | undefined) =>
  Option.match(Option.fromUndefinedOr(isStatic), {
    onNone: () => ({}),
    onSome: (present) => ({ static: present }),
  })

const coveredByField = (coveredBy: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(coveredBy), {
    onNone: () => ({}),
    onSome: (present) => ({ coveredBy: [...present] }),
  })

const testFilterField = (testFilter: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(testFilter), {
    onNone: () => ({}),
    onSome: (present) => ({ testFilter: [...present] }),
  })

const staticCoverageCountOf = (staticCoverage: Record<string, number> | undefined, mutantId: string) =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(staticCoverage),
      (countsByMutantId) => Option.fromUndefinedOr(countsByMutantId[mutantId]),
    ),
    () => ZERO,
  )

const hasCoverageForPlan = (staticCoverage: Record<string, number> | undefined) =>
  staticCoverage !== undefined && Object.keys(staticCoverage).length > ZERO

const hasStaticCoverageForPlan = (staticCoverage: Record<string, number> | undefined, mutantId: string) =>
  staticCoverageCountOf(staticCoverage, mutantId) > ZERO

const calculateTotalTimeForIds = (testIds: readonly string[], testTimeById: Record<string, number>) =>
  testIds.reduce(
    (acc, id) => acc + Option.getOrElse(Option.fromUndefinedOr(testTimeById[id]), () => ZERO),
    ZERO,
  )

const hitLimitForCount = (hitCount: number) => hitCount * HIT_LIMIT_FACTOR

const hitLimitOf = (hitCount: number | undefined) => Option.map(Option.fromUndefinedOr(hitCount), hitLimitForCount)

const mutantActivationOf = (testFilter: readonly string[] | undefined) =>
  Boolean.match(testFilter !== undefined, { onTrue: () => 'runtime' as const, onFalse: () => 'static' as const })

const coveredByOfMutant = (mutant: Mutant) => Option.map(Option.fromUndefinedOr(mutant.coveredBy), (c) => [...c])

const testFilterOf = (globalFilter: readonly string[] | undefined) =>
  Option.map(Option.fromUndefinedOr(globalFilter), (filter) => [...filter])

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
      reloadEnvironment: Match.value(testFilter).pipe(
        Match.when(undefined, () => true),
        Match.orElse(() => isStatic !== false),
      ),
      ...testFilterField(testFilter),
      ...Option.match(hitLimitOf(command.hitsByMutantId[mutant.id]), {
        onNone: () => ({}),
        onSome: (hitLimit) => ({ hitLimit }),
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
      onNone: () => ({}),
      onSome: (reason) => ({ statusReason: reason }),
    }),
    ...staticField(isStatic),
    ...coveredByField(coveredBy),
  })

const planForStaticallyCovered = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
): MutantPlanDecision => {
  const tests = Option.getOrElse(Option.fromUndefinedOr(command.testsByMutantId[mutant.id]), () => [])
  const coveredBy = [...tests]
  const ignoreStatic = command.options.ignoreStatic
  const useCovered = Match.value(isStatic).pipe(
    Match.when(false, () => true),
    Match.orElse(() => ignoreStatic && tests.length > ZERO),
  )
  return Match.value(useCovered).pipe(
    Match.when(
      true,
      () =>
        toRunPlan(
          mutant,
          command,
          calculateTotalTimeForIds(tests, command.testTimeById),
          coveredBy,
          isStatic,
          coveredBy,
        ),
    ),
    Match.orElse(() =>
      Match.value(ignoreStatic).pipe(
        Match.when(true, () =>
          toEarlyResultPlan(mutant, isStatic, 'Ignored', 'Static mutant (and "ignoreStatic" was enabled)', coveredBy)),
        Match.orElse(() =>
          toRunPlan(
            mutant,
            command,
            command.timeSpentAllTests,
            testFilterOf(command.globalTestFilter),
            isStatic,
            coveredBy,
          )
        ),
      )
    ),
  )
}

const hasCoveringTests = (tests: readonly string[] | undefined) => tests !== undefined && tests.length > ZERO

const mutantIsCovered = (command: MutantTestPlanCommand, mutantId: string) =>
  hasCoveringTests(command.testsByMutantId[mutantId]) ||
  hasStaticCoverageForPlan(command.staticCoverage, mutantId)

const coverageKnown = (command: MutantTestPlanCommand) => command.staticCoverage !== undefined

const isMissingHitCount = (hitCount: number | undefined, covered: boolean, coverageIsKnown: boolean) =>
  coverageIsKnown && covered && hitCount === undefined

const boundFor = (command: MutantTestPlanCommand, mutant: Mutant) =>
  isMissingHitCount(
    command.hitsByMutantId[mutant.id],
    mutantIsCovered(command, mutant.id),
    coverageKnown(command),
  )

const decidePlanForMutant = (mutant: Mutant, command: MutantTestPlanCommand): MutantPlanDecision => {
  const isStatic = hasStaticCoverageForPlan(command.staticCoverage, mutant.id)
  return Option.match(Option.fromUndefinedOr(mutant.status), {
    onSome: (status) => toEarlyResultPlan(mutant, isStatic, status, mutant.statusReason, coveredByOfMutant(mutant)),
    onNone: () =>
      Boolean.match(hasCoverageForPlan(command.staticCoverage), {
        onTrue: () => planForStaticallyCovered(mutant, command, isStatic),
        onFalse: () =>
          toRunPlan(
            mutant,
            command,
            command.timeSpentAllTests,
            testFilterOf(command.globalTestFilter),
            undefined,
            undefined,
          ),
      }),
  })
}

const isClosedMutant = (mutant: Mutant) => mutant.status !== undefined

const missingIdOf = (command: MutantTestPlanCommand, mutant: Mutant) =>
  Boolean.match(boundFor(command, mutant), { onTrue: () => [mutant.id], onFalse: () => [] })

const missingHitCountIds = (command: MutantTestPlanCommand) =>
  command.mutants
    .filter((mutant) => !isClosedMutant(mutant))
    .flatMap((mutant) => missingIdOf(command, mutant))

const decide = (
  command: MutantTestPlanCommand,
): Result.Result<readonly MutantPlanDecision[], StageError> => {
  const missing = missingHitCountIds(command)
  return Option.match(Array.head(missing), {
    onNone: () => Result.succeed(command.mutants.map((mutant) => decidePlanForMutant(mutant, command))),
    onSome: () =>
      Result.fail(
        StageError.make({
          stage: 'mutationTest',
          reason: `covered mutant missing dry-run hit count: ${missing.join(', ')}`,
        }),
      ),
  })
}

export const planMutantTests = Workflow.make({
  command: MutantTestPlanCommand,
  decision: S.Array(S.Union([PlannedRunMutant, PlannedEarlyResultMutant])),
  error: StageError,
  decide,
})
