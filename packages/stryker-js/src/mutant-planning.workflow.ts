import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { MutantRunOptionsSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StageError } from './Run.schema.js'
import type { TestCoverage } from './test-coverage.schema.js'
import { testCoverageOf } from './test-coverage.js'

export const HIT_LIMIT_FACTOR = 100

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
    timeSpentAllTests: 'stryker.mutant_test_plan.time_spent_all_tests',
  } as const
}

const MutantTestPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantTestPlan')
type MutantTestPlanTypeId = typeof MutantTestPlanTypeId

export class PlannedRunMutant extends S.TaggedClass<PlannedRunMutant>()('PlannedRunMutant', {
  plan: S.Literal('Run'),
  mutantId: S.String,
  netTime: S.Finite,
  runOptions: MutantRunOptionsSchema,
}) {
  readonly [MutantTestPlanTypeId] = MutantTestPlanTypeId
}

export class PlannedEarlyResultMutant extends S.TaggedClass<PlannedEarlyResultMutant>()('PlannedEarlyResultMutant', {
  plan: S.Literal('EarlyResult'),
  mutantId: S.String,
  status: MutantStatusSchema,
  statusReason: S.optional(S.String),
}) {
  readonly [MutantTestPlanTypeId] = MutantTestPlanTypeId
}

const staticCoverageCountOf = (
  staticCoverage: Record<string, number> | undefined,
  mutantId: string,
): number => Option.getOrElse(Option.fromUndefinedOr(staticCoverage?.[mutantId]), () => 0)

export const hitLimitForCount = (hitCount: number): number => hitCount * HIT_LIMIT_FACTOR

const coveredWhenKnown = (covered: boolean, coverageKnown: boolean): boolean => coverageKnown && covered

const isMissingHitCount = (
  hitCount: number | undefined,
  covered: boolean,
  coverageKnown: boolean,
): boolean => coveredWhenKnown(covered, coverageKnown) && hitCount === undefined

const hasCoveringTests = (tests: readonly string[] | undefined): boolean => (tests?.length ?? 0) > 0

const hasStaticCoverage = (staticCoverage: Record<string, number> | undefined, mutantId: string): boolean =>
  staticCoverageCountOf(staticCoverage, mutantId) > 0

const mutantIsCovered = (command: MutantTestPlanCommand, mutantId: string): boolean =>
  hasCoveringTests(command.testsByMutantId[mutantId]) || hasStaticCoverage(command.staticCoverage, mutantId)

const coverageKnown = (command: MutantTestPlanCommand): boolean => command.staticCoverage !== undefined

const boundFor = (command: MutantTestPlanCommand, mutantId: string): boolean =>
  isMissingHitCount(command.hitsByMutantId[mutantId], mutantIsCovered(command, mutantId), coverageKnown(command))

export const missingHitCountIds = (command: MutantTestPlanCommand): readonly string[] =>
  command.mutants.flatMap((mutant) =>
    Option.match(Option.fromUndefinedOr(mutant.status), {
      onSome: () => [],
      onNone: () => (boundFor(command, mutant.id) ? [mutant.id] : []),
    }))

const calculateTotalTimeForIds = (testIds: readonly string[], testTimeById: Record<string, number>): number =>
  testIds.reduce((acc, id) => acc + (testTimeById[id] ?? 0), 0)

const toRunPlan = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
  netTime: number,
  testFilter: readonly string[] | undefined,
): PlannedRunMutant =>
  PlannedRunMutant.make({
    plan: 'Run',
    mutantId: mutant.id,
    netTime,
    runOptions: {
      activeMutant: mutant,
      mutantActivation: Option.match(Option.fromUndefinedOr(testFilter), {
        onNone: () => 'static' as const,
        onSome: () => 'runtime' as const,
      }),
      timeout: command.options.timeoutFactor * netTime + command.options.timeoutMS + command.timeOverheadMS,
      sandboxFileName: Option.getOrElse(
        Option.fromUndefinedOr(command.sandboxFileByName[mutant.fileName]),
        () => mutant.fileName,
      ),
      disableBail: command.options.disableBail,
      reloadEnvironment: Option.match(Option.fromUndefinedOr(testFilter), {
        onNone: () => true,
        onSome: () => mutant.static !== false,
      }),
      ...Option.match(Option.fromUndefinedOr(testFilter), {
        onNone: () => ({}),
        onSome: (present) => ({ testFilter: [...present] }),
      }),
      ...Option.match(Option.fromUndefinedOr(command.hitsByMutantId[mutant.id]), {
        onNone: () => ({}),
        onSome: (hitCount) => ({ hitLimit: hitLimitForCount(hitCount) }),
      }),
    },
  })

const toEarlyResultPlan = (
  mutant: Mutant,
  status: MutantStatus,
  statusReason: string | undefined,
): PlannedEarlyResultMutant =>
  PlannedEarlyResult.make({
    plan: 'EarlyResult',
    mutantId: mutant.id,
    status,
    ...Option.match(Option.fromUndefinedOr(statusReason ?? mutant.statusReason), {
      onNone: () => ({}),
      onSome: (present) => ({ statusReason: present }),
    }),
  })

const planForStaticallyCovered = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
  isStatic: boolean,
): PlannedRunMutant | PlannedEarlyResultMutant => {
  const tests = Option.getOrElse(Option.fromUndefinedOr(command.testsByMutantId[mutant.id]), () => [])
  const useCovered = mutant.static === false || (command.options.ignoreStatic && tests.length > 0)
  return Match.value(useCovered).pipe(
    Match.when(true, () =>
      toRunPlan(mutant, command, calculateTotalTimeForIds(tests, command.testTimeById), [...tests])),
    Match.orElse(() =>
      Match.value(command.options.ignoreStatic).pipe(
        Match.when(true, () =>
          toEarlyResultPlan(
            mutant,
            'Ignored',
            'Static mutant (and "ignoreStatic" was enabled)',
          )),
        Match.orElse(() =>
          toRunPlan(mutant, command, command.timeSpentAllTests, command.globalTestFilter)),
      )
    ),
  )
}

const decidePlanForMutant = (
  mutant: Mutant,
  command: MutantTestPlanCommand,
): PlannedRunMutant | PlannedEarlyResultMutant =>
  Option.match(Option.fromUndefinedOr(mutant.status), {
    onSome: (status) => toEarlyResultPlan(mutant, status, mutant.statusReason),
    onNone: () =>
      Match.value(command.staticCoverage !== undefined && Object.keys(command.staticCoverage).length > 0).pipe(
        Match.when(true, () =>
          planForStaticallyCovered(mutant, command, hasStaticCoverage(command.staticCoverage, mutant.id))),
        Match.orElse(() =>
          toRunPlan(mutant, command, command.timeSpentAllTests, command.globalTestFilter)),
      ),
  })

export const planMutantTests = Workflow.make({
  command: MutantTestPlanCommand,
  decision: S.Array(S.Union([PlannedRunMutant, PlannedEarlyResultMutant])),
  error: StageError,
  decide: (command): Result.Result<readonly (PlannedRunMutant | PlannedEarlyResultMutant)[], StageError> => {
    const missing = missingHitCountIds(command)
    return Match.value(missing.length > 0).pipe(
      Match.when(true, () =>
        Result.fail(
          StageError.make({
            stage: 'mutationTest',
            reason: `covered mutant missing dry-run hit count: ${missing.join(', ')}`,
          }),
        )),
      Match.orElse(() =>
        Result.succeed(command.mutants.map((mutant) => decidePlanForMutant(mutant, command)))),
    )
  },
})
