import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import {
  cliConfigTextOf,
  PLAN_FILE,
  planWorkspaceFiles,
  removeWorkspace,
  REPORT_FILE,
  storedObservationIn,
  type StoreObservation,
  writeWorkspace,
} from './__fixtures__/check-cost-workspace.fixture.js'
import { recordedDryRunMsOf } from './__fixtures__/recorded-dry-run.schema.js'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const TARGET_SECONDS = '600'

const MAX_SHARDS = '8'

const CONFIG_FILE = 'stryker.config.mjs'

interface ExecOutcome {
  readonly exitCode: number
  readonly output: string
}

const spawnCli = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<ExecOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      return {
        exitCode: Number(exitCode),
        output: `${yield* Fiber.join(stdout)}\n${yield* Fiber.join(stderr)}`,
      }
    }),
  ).pipe(Effect.orDie)

const decodePlan = S.decodeUnknownOption(S.fromJsonString(ShardPlan))

interface ObservedPlan {
  readonly runExitCode: number
  readonly planExitCode: number
  readonly plan: ShardPlan | null
  readonly stored: StoreObservation
  readonly dryRunMs: number
  readonly output: string
}

const planAfterFullRun = (
  directory: string,
): Effect.Effect<
  ObservedPlan,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.writeFileString(path.join(directory, CONFIG_FILE), cliConfigTextOf(directory))
    const run = yield* spawnCli(directory, ['run'])
    const planRun = yield* spawnCli(directory, [
      'plan',
      '--target-seconds',
      TARGET_SECONDS,
      '--max-shards',
      MAX_SHARDS,
      '--out',
      PLAN_FILE,
      '--full',
    ])
    const planText = yield* fs.readFileString(path.join(directory, PLAN_FILE)).pipe(Effect.orElseSucceed(() => ''))
    const plan = Option.getOrNull(decodePlan(planText))
    const scheduledIds = plan === null
      ? []
      : plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants))
    const stored = yield* storedObservationIn({ projectRoot: directory, mutantIds: scheduledIds })
    const reportText = yield* fs.readFileString(path.join(directory, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return {
      runExitCode: run.exitCode,
      planExitCode: planRun.exitCode,
      plan,
      stored,
      dryRunMs: recordedDryRunMsOf(reportText),
      output: `${run.output}\n${planRun.output}`,
    }
  }).pipe(Effect.orDie)

const TEST_RUNNING_STATUSES: Readonly<Record<string, true>> = {
  Killed: true,
  Survived: true,
  Timeout: true,
}

const DECIDED_WITHOUT_A_TEST: Readonly<Record<string, true>> = {
  CompileError: true,
  NoCoverage: true,
  Ignored: true,
}

const roundMs = (seconds: number): number => Math.round(seconds * 1000)

const planSummaryOf = (observed: ObservedPlan) => {
  const plan = observed.plan
  if (plan === null) {
    return { planWritten: false, runExitCode: observed.runExitCode, planExitCode: observed.planExitCode }
  }
  const scheduledIds = plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants))
  const plannedSecondsMs = plan.shards.reduce((total, shard) => total + shard.predictedSeconds * 1000, 0)
  const storedCostsMs = scheduledIds.reduce((total, id) => total + (observed.stored.costs[id] ?? 0), 0)
  return {
    planWritten: true,
    runExitCode: observed.runExitCode,
    planExitCode: observed.planExitCode,
    everyScheduledMutantHasAStoredCost: scheduledIds.length > 0 &&
      scheduledIds.every((id) => observed.stored.costs[id] !== undefined),
    aCheckDecidedMutantIsScheduled: scheduledIds.some(
      (id) => DECIDED_WITHOUT_A_TEST[observed.stored.statuses[id] ?? ''] === true,
    ),
    aTestRunningMutantIsScheduled: scheduledIds.some(
      (id) => TEST_RUNNING_STATUSES[observed.stored.statuses[id] ?? ''] === true,
    ),
    thePlanPricesTheStoredCosts: roundMs(plannedSecondsMs) === roundMs(storedCostsMs + observed.dryRunMs),
  }
}

const observedPlanAfterFullRun: Effect.Effect<
  ObservedPlan,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function*() {
  const root = yield* writeWorkspace(planWorkspaceFiles)
  return yield* Effect.ensuring(planAfterFullRun(root), removeWorkspace(root))
}).pipe(Effect.orDie)

Feature('Shard planning on the measured costs a run records')
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs and then plans a workspace whose checker rejects mutants')
  .body(({ scenario }) => {
    scenario(
      'A full plan prices the mutants it schedules at the costs the run measured',
      Gherkin.Do.pipe(
        Given(
          'a workspace whose covered modules are checked by a rejecting checker and whose test runner passes, run in full and then planned in full',
        )('observed', () => observedPlanAfterFullRun),
        Then(
          'the plan prices its scheduled mutants at the costs stored with their verdicts',
        )((s, expect) =>
          expect(planSummaryOf(s.observed)).toEqual({
            planWritten: true,
            runExitCode: 0,
            planExitCode: 0,
            everyScheduledMutantHasAStoredCost: true,
            aCheckDecidedMutantIsScheduled: true,
            aTestRunningMutantIsScheduled: true,
            thePlanPricesTheStoredCosts: true,
          })
        ),
      ),
    )
  })
