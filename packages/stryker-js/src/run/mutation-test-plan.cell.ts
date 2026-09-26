import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Metric from 'effect/Metric'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckerMutantFromMutant, UndescribableMutant } from '../Checker/Checker.schema.js'
import { MaterializeMutantPlanCommand, materializeMutantPlans } from '../materialize-mutant-plans.workflow.js'
import { UnknownPlannedMutant } from '../MutantsError.schema.js'
import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import { planMutantTests } from '../plan-mutant-tests.workflow.js'
import type { Project } from '../Project.schema.js'
import { offerReporterEvent, type ReporterStage } from '../reporter-stream.service.js'
import { PlanKnown, RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'
import type { TestCoverage } from '../test-coverage.schema.js'

export const VALID_MUTANT_STATUSES = [
  'Killed',
  'Survived',
  'NoCoverage',
  'Timeout',
  'CompileError',
  'RuntimeError',
  'Ignored',
  'Pending',
] as const
export type ValidMutantStatus = typeof VALID_MUTANT_STATUSES[number]
export const isMutantStatus = (candidate: string): candidate is ValidMutantStatus =>
  VALID_MUTANT_STATUSES.some((status) => status === candidate)

export const toReportedMutant = (mutant: Mutant.Mutant): Mutant.MutantTestCoverage =>
  Object.assign(mutant, { coveredBy: mutant.coveredBy, static: mutant.static })

const sandboxFilePairsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(
    fileNames.map((fileName) =>
      Result.map(
        sandboxFileFor(sandbox, fileName),
        (sandboxFileName): readonly [string, string] => [fileName, sandboxFileName],
      )
    ),
  )

export interface SandboxFilesInput {
  readonly sandbox: SandboxHandle
  readonly fileNames: readonly string[]
}

export const sandboxFilesOf: (
  input: SandboxFilesInput,
) => Effect.Effect<readonly (readonly [string, string])[], StageError> = Effect.fn(
  'stryker.mutation_test.sandbox_files',
)(function*(input: SandboxFilesInput) {
  return yield* Effect.fromResult(sandboxFilePairsOf(input.sandbox, input.fileNames)).pipe(
    Effect.mapError((cause) =>
      StageError.make({ stage: 'mutationTest', reason: 'Failed to resolve sandbox file', cause })
    ),
  )
})

export const configuredTestFilesOf = (run: {
  readonly options: { readonly testFiles: readonly string[] }
  readonly project: { readonly testFiles: readonly string[] }
}): readonly string[] => run.options.testFiles.length === 0 ? [] : run.project.testFiles

const calculateTotalTime = (testResults: Iterable<TestRunner.TestResult>) =>
  [...testResults].reduce((acc, test) => acc + test.timeSpentMs, 0)

const toTestIds = (testResults: Iterable<TestRunner.TestResult>) => [...testResults].map((test) => test.id)

const hitsRecordOf = (testCoverage: TestCoverage) => Object.fromEntries(testCoverage.hitsByMutantId)

const testsByMutantIdRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) => [mutantId, toTestIds(tests)] as const),
  )

const testTimeRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries([...testCoverage.testsById].map(([id, result]) => [id, result.timeSpentMs] as const))

const planCommandOf = (
  mutants: readonly Mutant.Mutant[],
  testCoverage: TestCoverage,
  options: {
    readonly disableBail: boolean
    readonly timeoutMS: number
    readonly timeoutFactor: number
    readonly ignoreStatic: boolean
  },
  timeOverheadMS: number,
  globalTestFilter: string[] | undefined,
  sandboxFileByName: Record<string, string>,
) =>
  MutantTestPlanCommand.make({
    mutants: [...mutants],
    timeOverheadMS,
    timeSpentAllTests: testCoverage.testsById.pipe(MutableHashMap.values, calculateTotalTime),
    hitsByMutantId: hitsRecordOf(testCoverage),
    testsByMutantId: testsByMutantIdRecordOf(testCoverage),
    testTimeById: testTimeRecordOf(testCoverage),
    options,
    sandboxFileByName,
    ...Option.match(Option.fromNullishOr(testCoverage.staticCoverage), {
      onNone: () => ({}),
      onSome: (staticCoverage) => ({ staticCoverage }),
    }),
    ...Option.match(Option.fromUndefinedOr(globalTestFilter), {
      onNone: () => ({}),
      onSome: (testFilter) => ({ globalTestFilter: testFilter }),
    }),
  })

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>) =>
  new Map(mutants.map((mutant) => [mutant.id, mutant] as const))

const decidePlans = Effect.fn('stryker.mutation_test.decide_plans')(function*(
  input: Readonly<{
    mutants: readonly Mutant.Mutant[]
    testCoverage: TestCoverage
    options: {
      readonly disableBail: boolean
      readonly timeoutMS: number
      readonly timeoutFactor: number
      readonly ignoreStatic: boolean
    }
    timeOverheadMS: number
    globalTestFilter: string[] | undefined
    sandboxFileByName: Record<string, string>
  }>,
) {
  const command = planCommandOf(
    input.mutants,
    input.testCoverage,
    input.options,
    input.timeOverheadMS,
    input.globalTestFilter,
    input.sandboxFileByName,
  )
  return yield* Result.match(planMutantTests(command), {
    onFailure: (failure) =>
      Effect.fail(
        StageError.make({
          stage: 'mutationTest',
          reason: `covered mutant missing dry-run hit count: ${failure.missingIds.join(', ')}`,
          cause: failure,
        }),
      ),
    onSuccess: (decisions) => {
      const byId = mutantsByIdOf(input.mutants)
      return Effect.forEach(decisions, (decision) =>
        Option.match(Option.fromUndefinedOr(byId.get(decision.mutantId)), {
          onNone: () =>
            Effect.die(UnknownPlannedMutant.make({
              mutantId: decision.mutantId,
              message: `planner returned an unknown mutant id: ${decision.mutantId}`,
            })),
          onSome: (mutant) =>
            Effect.fromResult(
              materializeMutantPlans(MaterializeMutantPlanCommand.make({ mutant, plan: decision })),
            ).pipe(Effect.map((materialized) => materialized.plan)),
        }))
    },
  })
})

const earlyResultStatusOf = (mutant: Mutant.Mutant) =>
  Option.getOrElse(Option.fromUndefinedOr(mutant.status), () => 'Ignored' as const)

const earlyResultOf = Effect.fn('stryker.mutation_test.early_result')(function*(
  plan: Mutant.EarlyResultPlan,
) {
  const reportLocation = yield* Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(plan.mutant.location))
  return Object.assign({}, plan.mutant, {
    location: reportLocation,
    status: earlyResultStatusOf(plan.mutant),
  })
})

const partitionRunPlans = (plans: readonly Mutant.TestPlan[]) => ({
  runPlans: plans.filter((plan): plan is Mutant.RunPlan => plan.plan === 'Run'),
  earlyPlans: plans.filter((plan): plan is Mutant.EarlyResultPlan => plan.plan === 'EarlyResult'),
})

const sortRunPlans = (plans: readonly Mutant.RunPlan[]): readonly Mutant.RunPlan[] =>
  [...plans].sort(
    (left, right) => Number(left.runOptions.reloadEnvironment) - Number(right.runOptions.reloadEnvironment),
  )

const isPlannable = (mutant: Mutant.Mutant): boolean =>
  Result.isSuccess(S.decodeResult(CheckerMutantFromMutant)(mutant))

const DROPPED_IDS_IN_WARNING = 5

export const partitionPlannable = (mutants: readonly Mutant.Mutant[]) => ({
  plannable: mutants.filter(isPlannable),
  dropped: mutants.filter((candidate) => !isPlannable(candidate)),
})

const droppedIdsOf = (dropped: readonly Mutant.Mutant[]): string =>
  `${dropped.slice(0, DROPPED_IDS_IN_WARNING).map((mutant) => mutant.id).join(', ')}${
    Option.match(Option.liftPredicate(dropped.length, (count) => count > DROPPED_IDS_IN_WARNING), {
      onNone: () => '',
      onSome: (count) => `, +${count - DROPPED_IDS_IN_WARNING} more`,
    })
  }`

export const reportDroppedMutants = (dropped: readonly Mutant.Mutant[]) =>
  Option.match(Option.liftPredicate(dropped, (candidates) => candidates.length > 0), {
    onNone: () => Effect.void,
    onSome: (candidates) =>
      Effect.gen(function*() {
        yield* Metric.update(UndescribableMutant.skipped, candidates.length)
        yield* Effect.logWarning(
          `${candidates.length} mutant(s) cannot be described to a checker and were left out of the run (${
            droppedIdsOf(candidates)
          })`,
        )
      }),
  })

export interface MutationTestPlanInput {
  readonly mutants: readonly Mutant.Mutant[]
  readonly testCoverage: TestCoverage
  readonly options: {
    readonly disableBail: boolean
    readonly timeoutMS: number
    readonly timeoutFactor: number
    readonly ignoreStatic: boolean
  }
  readonly timeOverheadMS: number
  readonly sandbox: SandboxHandle
  readonly project: Project
  readonly rememberedCount: number
  readonly reporterStage: ReporterStage
}

export interface MutationTestPlan {
  readonly runPlans: readonly Mutant.RunPlan[]
  readonly earlyResults: readonly Mutant.RunMutantResult[]
  readonly plannedTotal: number
  readonly plansForReporter: readonly Mutant.RunPlan[]
}

export const planMutationTest = Effect.fn('stryker.mutation_test.plan')(function*(
  input: MutationTestPlanInput,
) {
  const sandboxFileByName: Record<string, string> = Object.fromEntries(
    yield* sandboxFilesOf({
      sandbox: input.sandbox,
      fileNames: [...MutableHashMap.keys(input.project.filesToMutate)],
    }),
  )
  const { runPlans, earlyPlans } = partitionRunPlans(
    yield* decidePlans({
      mutants: input.mutants,
      testCoverage: input.testCoverage,
      options: input.options,
      timeOverheadMS: input.timeOverheadMS,
      globalTestFilter: undefined,
      sandboxFileByName,
    }),
  )
  const earlyResults = yield* Effect.forEach(earlyPlans, (plan) => earlyResultOf(plan))
  const sortedPlans = sortRunPlans(runPlans)
  const plansForReporter: readonly Mutant.RunPlan[] = [...sortedPlans]
  const plannedTotal = sortedPlans.length + earlyResults.length + input.rememberedCount
  yield* offerReporterEvent(
    input.reporterStage,
    Reporter.MutationTestingPlanReady.make({
      total: plannedTotal,
      plans: plansForReporter.map((plan) => ({
        mutantId: plan.mutant.id,
        plan: plan.plan,
        netTime: plan.netTime,
        reloadEnvironment: plan.runOptions.reloadEnvironment,
      })),
    }),
  ).pipe(Effect.ignoreCause)
  const progressQueue = yield* RunEvents
  yield* Queue.offer(
    progressQueue,
    PlanKnown.make({ total: plansForReporter.length + earlyResults.length }),
  )
  return { runPlans: sortedPlans, earlyResults, plannedTotal, plansForReporter }
})
