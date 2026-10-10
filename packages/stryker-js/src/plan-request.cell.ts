import { Cell } from '@systemfsoftware/effect-cell-types'
import { RunEvent, ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import type { IncrementalReportDiscard } from './admit-incremental-report.workflow.js'
import { scoped as checkerPoolsScoped } from './Checker/checker-pool.blueprint.js'
import { makeCheckerPoolHandle, programDigestOf } from './Checker/checker-pool.handle.js'
import { type DryRunCoverage, ReportedDryRunCoverageSchema } from './dry-run-coverage.schema.js'
import { DryRunCoverageReused } from './dry-run-reuse.workflow.js'
import { Anchored, placementAnchors, PlacementAnchorsCommand } from './placement-anchors.workflow.js'
import { CompileErrorProbeSchema, CostsFieldSchema } from './plan-request.schema.js'
import { type PlannedMutant, planShards, PlanShardsCommand } from './plan-shards.workflow.js'
import type { LoadedPlugins } from './Plugins.schema.js'
import { forEachProjectDirectory } from './project-directory.js'
import { readProjectCell } from './read-project.cell.js'
import { requireDryRun, type RequireDryRunDecision } from './require-dry-run.workflow.js'
import { dryRunChoiceOf, requireDryRunCommandOf } from './run/dry-run-choice.js'
import { reusedTestCoverage } from './run/dry-run-coverage.js'
import type { HostServices } from './run/host.service.js'
import { readIncrementalReuse, type RefusalCounts } from './run/incremental-reuse.cell.js'
import { incrementalReportTextsOf, optionalField } from './run/incremental-reuse.js'
import { loadConfigCell } from './run/load-config.cell.js'
import { planInstrumentCell, type PlanInstrumentDone } from './run/plan-instrument.cell.js'
import { prepareForInstrumentCell } from './run/plan-prepare.cell.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import type { EnginePorts, RunStageServices } from './run/StageServices.service.js'
import type { TestCoverage } from './test-coverage.schema.js'

export interface PlanShardsRequest {
  readonly targetSeconds: number
  readonly maxShards?: number | undefined
  readonly projects?: ReadonlyArray<string> | undefined
  readonly out?: string | undefined
  readonly full: boolean
}

export interface PlanChannel {
  readonly environment: {
    readonly basePath: string
    readonly host: HostServices
    readonly console: Console.Console
  }
}

export interface PlanRequestInput {
  readonly request: PlanShardsRequest
  readonly channel: PlanChannel
}

const DEFAULT_MUTANT_COST_MS = 1_000

const prepareStageCell = Cell.andThen(Cell.andThen(loadConfigCell, readProjectCell), prepareForInstrumentCell)

const namedCostsOf = (
  costs: NonNullable<typeof CostsFieldSchema.Type['costs']>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(costs).flatMap(([mutantId, entry]) =>
      Option.toArray(
        Option.map(
          Option.orElse(Option.fromNullishOr(entry.actualMs), () => Option.fromNullishOr(entry.predictedMs)),
          (costMs): readonly [string, number] => [mutantId, costMs],
        ),
      )
    ),
  )

const reportCostsOf = (texts: readonly string[]): Record<string, number> =>
  texts.reduce<Record<string, number>>(
    (accumulated, text) =>
      Option.match(S.decodeOption(S.fromJsonString(CostsFieldSchema))(text), {
        onNone: () => accumulated,
        onSome: (decoded) =>
          Option.match(Option.fromUndefinedOr(decoded.costs), {
            onNone: () => accumulated,
            onSome: (costs) => ({ ...namedCostsOf(costs), ...accumulated }),
          }),
      }),
    {},
  )

const decodeCoverage = (text: string): Option.Option<DryRunCoverage> =>
  Option.flatMap(
    S.decodeOption(S.fromJsonString(ReportedDryRunCoverageSchema))(text),
    (report) => Option.fromNullishOr(report.dryRunCoverage),
  )

const firstCoverageOf = (texts: readonly string[]): Option.Option<DryRunCoverage> =>
  Option.firstSomeOf(texts.map(decodeCoverage))

const testsTimeOf = (tests: ReadonlyArray<{ readonly timeSpentMs: number }>): number =>
  tests.reduce((total, test) => total + test.timeSpentMs, 0)

const runsWholeSuite = (testCoverage: TestCoverage, mutantId: string): boolean =>
  Option.match(Option.fromNullishOr(testCoverage.staticCoverage), {
    onNone: () => true,
    onSome: (staticCoverage) => Option.getOrElse(Option.fromUndefinedOr(staticCoverage[mutantId]), () => 0) > 0,
  })

const coveringCostOf = (
  coverage: DryRunCoverage,
  testCoverage: TestCoverage,
  mutantId: string,
): Option.Option<number> =>
  Option.orElse(
    Option.map(
      Option.filter(
        Option.map(MutableHashMap.get(testCoverage.testsByMutantId, mutantId), (tests) => testsTimeOf([...tests])),
        (millis) => millis > 0,
      ),
      (millis) => millis + coverage.timeOverheadMs,
    ),
    () =>
      Option.filter(
        Option.some(testsTimeOf(coverage.tests) + coverage.timeOverheadMs),
        () => runsWholeSuite(testCoverage, mutantId),
      ),
  )

const costOf = (
  mutantId: string,
  reportCosts: Record<string, number>,
  coverage: Option.Option<DryRunCoverage>,
  testCoverage: TestCoverage,
): number =>
  Option.getOrElse(
    Option.orElse(
      Record.get(reportCosts, mutantId),
      () => Option.flatMap(coverage, (present) => coveringCostOf(present, testCoverage, mutantId)),
    ),
    () => DEFAULT_MUTANT_COST_MS,
  )

const emptyTestCoverage = (): TestCoverage => ({
  testsByMutantId: MutableHashMap.empty(),
  testsById: MutableHashMap.empty(),
  staticCoverage: undefined,
  hitsByMutantId: MutableHashMap.empty(),
  dryRunCoverage: undefined,
})

interface ReuseObservation {
  readonly reused: number
  readonly ran: number
  readonly refused: RefusalCounts
  readonly discard?: IncrementalReportDiscard | undefined
}

const dependentMutantIdsOf = (decision: RequireDryRunDecision): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tag('DryRunNeeded', (needed) => needed.dependentMutantIds),
    Match.tag('DryRunSkippable', (): ReadonlyArray<string> => []),
    Match.exhaustive,
  )

interface ProjectPlan {
  readonly label: string
  readonly mutants: ReadonlyArray<{
    readonly id: Mutant.MutantId
    readonly costMs: number
    readonly dependsOnDryRun: boolean
    readonly anchors?: PlannedMutant['anchors']
  }>
  readonly dryRunCostMs: number
  readonly reuse: ReuseObservation
}

const labelOf = (path: Path.Path, basePath: string, project: string): string => {
  const relative = path.relative(basePath, project).replace(/\\/g, '/')
  return relative.length === 0 ? '.' : relative
}

const reportHoldsCompileErrorRecord = (text: string): boolean =>
  Option.exists(
    S.decodeOption(S.fromJsonString(CompileErrorProbeSchema))(text),
    (report) =>
      Object.values(report.files).some((file) => file.mutants.some((mutant) => mutant.status === 'CompileError')),
  )

interface ProgramDigestAtPlanTime {
  readonly texts: readonly string[]
  readonly context: Context.Context<RunStageServices>
  readonly options: Options.StrykerOptions
  readonly loadedPlugins: Pick<LoadedPlugins, 'pluginSources'>
  readonly project: string
}

const programDigestAtPlanTime = ({
  texts,
  context,
  options,
  loadedPlugins,
  project,
}: ProgramDigestAtPlanTime): Effect.Effect<string | undefined, never, EnginePorts> =>
  Boolean.match(Boolean.and(Boolean.not(options.inPlace), texts.some(reportHoldsCompileErrorRecord)), {
    onTrue: () =>
      Effect.gen(function*() {
        const pool = yield* checkerPoolsScoped({ options, loadedPlugins, size: 1, workingDirectory: project })
        return yield* Option.match(Option.fromNullishOr(pool), {
          onNone: () => Effect.as(Effect.void, undefined),
          onSome: (present) => programDigestOf(makeCheckerPoolHandle(present), project),
        })
      }).pipe(Effect.provide(context), Effect.scoped),
    onFalse: () => Effect.as(Effect.void, undefined),
  })

const anchorsFieldOf = (anchorsById: Record.ReadonlyRecord<string, Anchored['anchors']>, id: Mutant.MutantId) =>
  optionalField('anchors', Option.getOrUndefined(Record.get(anchorsById, id)))

const planProject = (
  request: PlanShardsRequest,
  channel: PlanChannel,
  labelBase: string,
  directory: string,
): Effect.Effect<ProjectPlan, never, EnginePorts | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    const project = yield* fs.realPath(path.resolve(basePath, directory))
    const env = { ...channel.environment.host.env, basePath: project }
    const context = yield* Layer.build(RunEnvironment.stage(env, channel.environment.host.events))
    const stageInput = { cliOptions: { force: request.full }, targetMutatePatterns: undefined }
    const prepared = yield* Cell.provideContext(prepareStageCell, context).run(stageInput)
    const done: PlanInstrumentDone = yield* Cell.provideContext(planInstrumentCell, context).run(prepared)
    const texts = yield* incrementalReportTextsOf({ basePath: project, options: done.options })
    const coverage = firstCoverageOf(texts)
    const testCoverage = Option.match(coverage, { onNone: emptyTestCoverage, onSome: reusedTestCoverage })
    const reportCosts = reportCostsOf(texts)
    const label = labelOf(path, labelBase, project)
    const programDigest = yield* programDigestAtPlanTime({
      texts,
      context,
      options: done.options,
      loadedPlugins: prepared.loadedPlugins,
      project,
    })
    const reuse = yield* readIncrementalReuse({
      project: done.project,
      currentMutants: [...done.mutants],
      testCoverage,
      basePath: project,
      force: request.full,
      options: done.options,
      globalTestInputs: Option.map(coverage, (present) => [...present.globalTestInputs]).pipe(
        Option.getOrElse((): ReadonlyArray<string> => []),
      ),
      observedModules: Option.getOrUndefined(Option.map(coverage, (present) => present.testFileModules)),
      originalFileOf: (file) => path.resolve(file),
      programDigestOf: Effect.succeed(programDigest),
    })
    const dryRunDecision = Result.getOrElse(
      requireDryRun(
        requireDryRunCommandOf({
          options: done.options,
          mutants: [...reuse.mutants, ...reuse.rememberedResults],
          texts,
        }),
      ),
      (neverError) => neverError,
    )
    const dependentIds = HashSet.fromIterable(dependentMutantIdsOf(dryRunDecision))
    const dryRunChoice = yield* dryRunChoiceOf(done, project)
    const dryRunCostMs = Boolean.match(S.is(DryRunCoverageReused)(dryRunChoice.decision), {
      onTrue: () => 0,
      onFalse: () =>
        Option.getOrElse(
          Option.map(coverage, (present) => testsTimeOf(present.tests) + present.timeOverheadMs),
          () => DEFAULT_MUTANT_COST_MS,
        ),
    })
    const anchors = Record.fromEntries(
      Result.getOrElse(
        placementAnchors(PlacementAnchorsCommand.make({ mutants: [...reuse.mutants, ...reuse.rememberedResults] })),
        (neverError) => neverError,
      ).filter(S.is(Anchored)).map((anchored) => [anchored.id, anchored.anchors] as const),
    )
    const mutants = [
      ...reuse.mutants.map((mutant) => ({
        id: mutant.id,
        costMs: costOf(mutant.id, reportCosts, coverage, testCoverage),
        dependsOnDryRun: HashSet.has(dependentIds, mutant.id),
        ...anchorsFieldOf(anchors, mutant.id),
      })),
      ...reuse.rememberedResults.map((mutant) => ({
        id: mutant.id,
        costMs: 0,
        dependsOnDryRun: HashSet.has(dependentIds, mutant.id),
        ...anchorsFieldOf(anchors, mutant.id),
      })),
    ]
    return {
      label,
      mutants,
      dryRunCostMs,
      reuse: {
        reused: reuse.rememberedResults.length,
        ran: reuse.mutants.length,
        refused: reuse.refusalCounts,
        ...(done.incrementalReportDiscard === undefined
          ? {}
          : { discard: done.incrementalReportDiscard }),
      },
    }
  }).pipe(Effect.orDie)

const assemblePlan = (
  request: PlanShardsRequest,
  planned: ReadonlyArray<PlannedMutant>,
  dryRunCosts: Record<string, number>,
): ShardPlan => {
  const shards = Result.getOrElse(
    planShards(
      PlanShardsCommand.make({
        targetSeconds: request.targetSeconds,
        maxShards: request.maxShards,
        mutants: planned.map((mutant) => ({ ...mutant })),
        dryRunCosts,
      }),
    ),
    (neverError) => neverError,
  )
  return {
    version: 1,
    targetSeconds: request.targetSeconds,
    shards: shards.map((shard) => ({
      index: shard.index,
      count: shard.count,
      predictedSeconds: shard.predictedSeconds,
      projects: shard.projects.map((entry) => ({ project: entry.project, mutants: [...entry.mutants] })),
    })),
    matrix: {
      include: shards.map((shard) => ({
        shard: `${shard.index}/${shard.count}`,
        predictedSeconds: shard.predictedSeconds,
      })),
    },
  }
}

const writePlan = (
  request: PlanShardsRequest,
  channel: PlanChannel,
  plan: ShardPlan,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* Effect.orDie(S.encodeEffect(S.fromJsonString(ShardPlan, { space: 2 }))(plan))
    return yield* Option.match(Option.fromUndefinedOr(request.out), {
      onNone: () => Effect.sync(() => channel.environment.console.log(text)),
      onSome: (out) =>
        Effect.gen(function*() {
          const target = path.resolve(channel.environment.basePath, out)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, text)
        }),
    })
  }).pipe(Effect.orDie)

const labelBaseOf = (path: Path.Path, basePath: string, out: string | undefined): string =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(out), (present) => path.dirname(path.resolve(basePath, present))),
    () => basePath,
  )

const planReuseRowOf = (entry: ProjectPlan): RunEvent.PlanProjectReuse =>
  RunEvent.PlanProjectReuse.make({
    project: entry.label,
    reused: entry.reuse.reused,
    ran: entry.reuse.ran,
    refused: entry.reuse.refused,
    ...Option.match(Option.fromUndefinedOr(entry.reuse.discard), {
      onNone: (): Readonly<Record<string, never>> => ({}),
      onSome: (discard) => ({
        discard: RunEvent.PlanReportDiscard.make({
          reason: discard.reason,
          expected: discard.expected,
          ...Option.match(Option.fromUndefinedOr(discard.actual), {
            onNone: (): Readonly<Record<string, never>> => ({}),
            onSome: (actual) => ({ actual }),
          }),
        }),
      }),
    }),
  })

export const planRequest = ({ request, channel }: PlanRequestInput): Effect.Effect<void, never, EnginePorts> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const labelBase = labelBaseOf(path, channel.environment.basePath, request.out)
    const planned = yield* forEachProjectDirectory(
      request.projects,
      (directory) => planProject(request, channel, labelBase, directory),
    )
    const scheduled = planned.flatMap((entry) => entry.mutants.map((mutant) => ({ project: entry.label, ...mutant })))
    const dryRunCosts: Record<string, number> = Object.fromEntries(
      planned.map((entry) => [entry.label, entry.dryRunCostMs]),
    )
    const plan = assemblePlan(request, scheduled, dryRunCosts)
    yield* Queue.offer(
      channel.environment.host.events,
      RunEvent.PlanKnown.make({
        total: scheduled.length,
        shardPlan: plan,
        projects: planned.map(planReuseRowOf),
      }),
    )
    yield* writePlan(request, channel, plan).pipe(Effect.orDie)
  }).pipe(Effect.scoped)
