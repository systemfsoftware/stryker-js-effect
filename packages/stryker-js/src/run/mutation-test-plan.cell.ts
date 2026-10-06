import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Options, Reporter, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'

import { MaterializeMutantPlanCommand, materializeMutantPlans } from '../materialize-mutant-plans.workflow.js'
import { UnknownPlannedMutant } from '../MutantsError.schema.js'
import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  CoveredMutantHitCountMissing,
  MutantTimeoutNotFinite,
  planMutantTests,
  PlannedEarlyResultMutant,
  PlannedRunMutant,
} from '../plan-mutant-tests.workflow.js'
import type { Project } from '../Project.schema.js'
import { offerReporterEvent, type ReporterStage } from '../reporter-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { OrderedRunPlan, SortRunPlans, sortRunPlans } from '../sort-run-plans.workflow.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { sandboxFilesOf } from './mutation-test-plan.js'

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
    readonly coverageAnalysis: Options.CoverageAnalysisModeType
    readonly disableBail: boolean
    readonly timeoutMS: number
    readonly timeoutFactor: number
    readonly ignoreStatic: boolean
  },
  timeOverheadMS: number,
  globalTestFilter: string[] | undefined,
  priorKilledByByMutantId: Record<string, readonly string[]> | undefined,
  sandboxFileByName: Record<string, string>,
): typeof MutantTestPlanCommand.Encoded => ({
  _tag: 'MutantTestPlanCommand',
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
  ...Option.match(Option.fromUndefinedOr(priorKilledByByMutantId), {
    onNone: () => ({}),
    onSome: (byMutantId) => ({ priorKilledByByMutantId: byMutantId }),
  }),
})

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>): Record<string, Mutant.Mutant> =>
  Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant] as const))

type MutantTestPlanRaw = typeof MutantTestPlanCommand.Encoded & {
  readonly mutantsById: Record<string, Mutant.Mutant>
}

const readPlanCommand = Effect.fn(SpanTaxonomy.Spans.mutationTestPlanRead.name)(
  function*(input: MutationTestPlanInput) {
    const sandboxFileByName: Record<string, string> = Object.fromEntries(
      yield* sandboxFilesOf({
        sandbox: input.sandbox,
        fileNames: [...MutableHashMap.keys(input.project.filesToMutate)],
      }),
    )
    const command = planCommandOf(
      input.mutants,
      input.testCoverage,
      input.options,
      input.timeOverheadMS,
      undefined,
      input.priorKilledByByMutantId,
      sandboxFileByName,
    )
    return { ...command, mutantsById: mutantsByIdOf(input.mutants) }
  },
)

type EncodedPlannedDecision = typeof PlannedRunMutant.Encoded | typeof PlannedEarlyResultMutant.Encoded

const plannedPlanOf = (
  mutant: Mutant.Mutant,
  decision: EncodedPlannedDecision,
): PlannedRunMutant | PlannedEarlyResultMutant =>
  Match.value(decision).pipe(
    Match.tag('PlannedRunMutant', (run) => PlannedRunMutant.make({ ...run, mutantId: mutant.id })),
    Match.tag('PlannedEarlyResultMutant', (early) => PlannedEarlyResultMutant.make({ ...early, mutantId: mutant.id })),
    Match.exhaustive,
  )

const materializeDecision = Effect.fnUntraced(function*(
  decision: EncodedPlannedDecision,
  command: MutantTestPlanRaw,
): Effect.fn.Return<Mutant.TestPlan, StageError> {
  const mutant = yield* Option.match(Record.get(command.mutantsById, decision.mutantId), {
    onNone: () =>
      Effect.die(
        UnknownPlannedMutant.make({
          mutantId: Mutant.MutantId.make(decision.mutantId),
          message: `planner returned an unknown mutant id: ${decision.mutantId}`,
        }),
      ),
    onSome: Effect.succeed,
  })
  return yield* Effect.fromResult(
    materializeMutantPlans(MaterializeMutantPlanCommand.make({ mutant, plan: plannedPlanOf(mutant, decision) })),
  ).pipe(Effect.map((materialized) => materialized.plan))
})

const earlyResultStatusOf = (mutant: Mutant.Mutant) =>
  Option.getOrElse(Option.fromUndefinedOr(mutant.status), () => 'Ignored' as const)

const earlyResultOf = Effect.fn(SpanTaxonomy.Spans.mutationTestEarlyResult.name)((plan: Mutant.EarlyResultPlan) =>
  Effect.succeed(Object.assign({}, plan.mutant, {
    status: earlyResultStatusOf(plan.mutant),
  }))
)

const partitionRunPlans = (plans: readonly Mutant.TestPlan[]) => ({
  runPlans: plans.filter((plan): plan is Mutant.RunPlan => plan.plan === 'Run'),
  earlyPlans: plans.filter((plan): plan is Mutant.EarlyResultPlan => plan.plan === 'EarlyResult'),
})

const sortedRunPlans = (plans: readonly Mutant.RunPlan[]): readonly Mutant.RunPlan[] => {
  const plansById = Object.fromEntries(plans.map((plan) => [plan.mutant.id, plan] as const))
  const ordered = Result.getOrThrow(
    sortRunPlans(
      SortRunPlans.make({
        plans: plans.map((plan) =>
          OrderedRunPlan.make({
            id: plan.mutant.id,
            netTime: plan.netTime,
            reloadEnvironment: plan.runOptions.reloadEnvironment,
          })
        ),
      }),
    ),
  )
  return ordered.flatMap((cost) => Option.toArray(Record.get(plansById, cost.id)))
}

const planMutantTestsCell = Sandwich.named(SpanTaxonomy.Spans.mutationTestPlanMutants.name)(readPlanCommand)
  .decide(planMutantTests)
  .write({
    PlannedRunMutant: (decision, command) => materializeDecision(decision, command),
    PlannedEarlyResultMutant: (decision, command) => materializeDecision(decision, command),
    CoveredMutantHitCountMissing: ({ missingIds }) =>
      Effect.fail(
        StageError.make({
          stage: 'mutationTest',
          reason: `covered mutant missing dry-run hit count: ${missingIds.join(', ')}`,
          cause: CoveredMutantHitCountMissing.make({ missingIds }),
        }),
      ),
    MutantTimeoutNotFinite: ({ mutantId }) =>
      Effect.fail(
        StageError.make({
          stage: 'mutationTest',
          reason: `mutant ${mutantId} has a non-finite timeout`,
          cause: MutantTimeoutNotFinite.make({ mutantId: Mutant.MutantId.make(mutantId) }),
        }),
      ),
    CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
  })

export interface MutationTestPlanInput {
  readonly mutants: readonly Mutant.Mutant[]
  readonly testCoverage: TestCoverage
  readonly options: {
    readonly coverageAnalysis: Options.CoverageAnalysisModeType
    readonly disableBail: boolean
    readonly timeoutMS: number
    readonly timeoutFactor: number
    readonly ignoreStatic: boolean
  }
  readonly timeOverheadMS: number
  readonly priorKilledByByMutantId?: Record<string, readonly string[]> | undefined
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

export const planMutationTest = Effect.fn(SpanTaxonomy.Spans.mutationTestPlan.name)(function*(
  input: MutationTestPlanInput,
) {
  const plans = yield* planMutantTestsCell.run(input)
  const { runPlans, earlyPlans } = partitionRunPlans(plans)
  const earlyResults = yield* Effect.forEach(earlyPlans, (plan) => earlyResultOf(plan))
  const sortedPlans = sortedRunPlans(runPlans)
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
    RunEvent.PlanKnown.make({ total: plansForReporter.length + earlyResults.length, shardPlan: null }),
  )
  return { runPlans: sortedPlans, earlyResults, plannedTotal, plansForReporter }
})
