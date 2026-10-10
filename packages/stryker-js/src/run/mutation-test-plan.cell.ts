import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Options, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Struct from 'effect/Struct'

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
import type { ReporterStage } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { OrderedRunPlan, SortRunPlans, sortRunPlans } from '../sort-run-plans.workflow.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { optionalField } from './incremental-reuse.js'
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

const isSubsumed = (mutant: Mutant.Mutant): boolean =>
  Option.exists(Option.fromUndefinedOr(mutant.subsumption), S.is(Mutant.Subsumed))

const planningMutantOf = (mutant: Mutant.Mutant): Mutant.Mutant =>
  isSubsumed(mutant)
    ? Mutant.Mutant.make({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
      ...optionalField('static', mutant.static),
      ...optionalField(
        'coveredBy',
        Option.getOrUndefined(Option.map(Option.fromUndefinedOr(mutant.coveredBy), (tests) => [...tests])),
      ),
      ...optionalField('testsCompleted', mutant.testsCompleted),
      ...optionalField('description', mutant.description),
    })
    : mutant

type MutantTestPlanRaw = typeof MutantTestPlanCommand.Encoded & {
  readonly mutantsById: Record<string, Mutant.Mutant>
}

const readPlanCommand = Effect.fn(SpanTaxonomy.Spans.mutationTestPlanRead.name)(
  function*(input: MutationTestPlanInput) {
    const sandboxFileByName: Record<string, string> = Object.fromEntries(
      yield* sandboxFilesOf({
        sandbox: input.sandbox,
        fileNames: [...input.project.filesToMutate.keys()],
      }),
    )
    const planningMutants = input.mutants.map(planningMutantOf)
    const command = planCommandOf(
      planningMutants,
      input.testCoverage,
      input.options,
      input.timeOverheadMS,
      undefined,
      input.priorKilledByByMutantId,
      sandboxFileByName,
    )
    return { ...command, mutantsById: mutantsByIdOf(planningMutants) }
  },
)

type EncodedPlannedDecision = typeof PlannedRunMutant.Encoded | typeof PlannedEarlyResultMutant.Encoded

const plannedPlanOf = (
  mutant: Mutant.Mutant,
  decision: EncodedPlannedDecision,
): PlannedRunMutant | PlannedEarlyResultMutant =>
  Match.value(decision).pipe(
    Match.tag('PlannedRunMutant', (run) =>
      PlannedRunMutant.make({ ...Struct.omit(run, ['heldBy']), mutantId: mutant.id })),
    Match.tag('PlannedEarlyResultMutant', (early) =>
      PlannedEarlyResultMutant.make({ ...early, mutantId: mutant.id })),
    Match.exhaustive,
  )

const heldByOf = (mutant: Mutant.Mutant, decision: EncodedPlannedDecision): Option.Option<Mutant.Guard> =>
  Match.value(decision).pipe(
    Match.tag(
      'PlannedRunMutant',
      (run) => Option.filter(Option.fromUndefinedOr(mutant.guard), () => run.heldBy !== undefined),
    ),
    Match.orElse(() => Option.none()),
  )

interface DraftedPlan {
  readonly plan: Mutant.TestPlan
  readonly heldBy: Option.Option<Mutant.Guard>
}

const materializeDecision = Effect.fnUntraced(function*(
  decision: EncodedPlannedDecision,
  command: MutantTestPlanRaw,
): Effect.fn.Return<DraftedPlan, StageError> {
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
  ).pipe(Effect.map((materialized) => ({ plan: materialized.plan, heldBy: heldByOf(mutant, decision) })))
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

export interface HeldSubsumedPlan {
  readonly plan: Mutant.RunPlan
  readonly subsumed: Mutant.Subsumed
}

export interface HeldGuardPlan {
  readonly plan: Mutant.RunPlan
  readonly guard: Mutant.Guard
}

export interface MutationTestPlan {
  readonly runPlans: readonly Mutant.RunPlan[]
  readonly earlyResults: readonly Mutant.RunMutantResult[]
  readonly heldSubsumed: readonly HeldSubsumedPlan[]
  readonly heldGuards: readonly HeldGuardPlan[]
  readonly plannedTotal: number
  readonly plansForReporter: readonly Mutant.RunPlan[]
}

const subsumedByIdOf = (mutants: readonly Mutant.Mutant[]): ReadonlyMap<string, Mutant.Subsumed> =>
  new Map(
    mutants.flatMap((mutant) =>
      Option.match(Option.filter(Option.fromUndefinedOr(mutant.subsumption), S.is(Mutant.Subsumed)), {
        onNone: (): readonly (readonly [string, Mutant.Subsumed])[] => [],
        onSome: (subsumed) => [[mutant.id, subsumed] as const],
      })
    ),
  )

const heldGuardByIdOf = (drafted: readonly DraftedPlan[]): ReadonlyMap<string, Mutant.Guard> =>
  new Map(
    drafted.flatMap(({ plan, heldBy }) =>
      Option.match(heldBy, {
        onNone: (): readonly (readonly [string, Mutant.Guard])[] => [],
        onSome: (guard) => [[plan.mutant.id, guard] as const],
      })
    ),
  )

export const draftMutationTestPlan = Effect.fn(SpanTaxonomy.Spans.mutationTestPlan.name)(function*(
  input: MutationTestPlanInput,
) {
  const subsumedById = subsumedByIdOf(input.mutants)
  const drafted = yield* planMutantTestsCell.run(input)
  const heldGuardById = heldGuardByIdOf(drafted)
  const { runPlans, earlyPlans } = partitionRunPlans(drafted.map(({ plan }) => plan))
  const heldSubsumed: readonly HeldSubsumedPlan[] = runPlans.flatMap((plan) =>
    Option.match(Option.fromUndefinedOr(subsumedById.get(plan.mutant.id)), {
      onNone: (): readonly HeldSubsumedPlan[] => [],
      onSome: (subsumed) => [{ plan, subsumed }],
    })
  )
  const heldGuards: readonly HeldGuardPlan[] = runPlans.flatMap((plan) =>
    Option.match(Option.fromUndefinedOr(heldGuardById.get(plan.mutant.id)), {
      onNone: (): readonly HeldGuardPlan[] => [],
      onSome: (guard) => [{ plan, guard }],
    })
  )
  const keptRunPlans = runPlans.filter((plan) =>
    !subsumedById.has(plan.mutant.id) && !heldGuardById.has(plan.mutant.id)
  )
  const earlyResults = yield* Effect.forEach(earlyPlans, (plan) => earlyResultOf(plan))
  const sortedPlans = sortedRunPlans(keptRunPlans)
  const plansForReporter: readonly Mutant.RunPlan[] = [...sortedPlans]
  const plannedTotal = sortedPlans.length + earlyResults.length + heldSubsumed.length + heldGuards.length +
    input.rememberedCount
  return {
    runPlans: sortedPlans,
    earlyResults,
    heldSubsumed,
    heldGuards,
    plannedTotal,
    plansForReporter,
  } satisfies MutationTestPlan
})
