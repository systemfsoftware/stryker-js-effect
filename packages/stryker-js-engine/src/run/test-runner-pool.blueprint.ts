import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { Workers } from '@systemfsoftware/stryker-js-contracts'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Pool from 'effect/Pool'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/TestRunnerPoolBlueprint')
export type TypeId = typeof TypeId

export interface TestRunnerPoolSpec {
  readonly options: Options.StrykerOptions
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly sandboxWorkingDirectory: string
  readonly idGenerator: Workers.IdGeneratorShape
  readonly testFiles: readonly string[]
  readonly loadedPlugins: Pick<Workers.LoadedPlugins, 'pluginSources'>
  readonly min: number
  readonly max: number
}

const IDLE_TIME_TO_LIVE = Duration.minutes(1)

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(WorkerHost.testRunnerConfigOf(configured)).pipe(
    Match.when(Options.isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const testRunnerWorkerSpawnOf = (
  loaded: Pick<Workers.LoadedPlugins, 'pluginSources'>,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, Run.StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(
        WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind: 'TestRunner', configured }),
      ),
    ),
    (missing) =>
      Run.StageError.make({
        stage: 'mutationTest',
        reason: missing.reason,
        cause: Workers.PluginNotFoundError.make({ descriptor: missing.descriptor }),
      }),
  )

const acquire: (
  spec: TestRunnerPoolSpec,
) => Effect.Effect<
  Pool.Pool<WorkerHost.PooledTestRunner, Run.StageError | Workers.PooledTestRunnerError>,
  never,
  | Scope.Scope
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Workers.WorkerLauncher
  | Run.WorkerReports
> = Effect.fnUntraced(function*(spec: TestRunnerPoolSpec) {
  const reports = yield* Run.WorkerReports
  const acquireOne: Effect.Effect<
    WorkerHost.PooledTestRunner,
    Run.StageError | Workers.PooledTestRunnerError,
    Scope.Scope | Workers.WorkerLauncher | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > = Effect.gen(function*() {
    const startedAt = yield* Clock.currentTimeMillis
    const runner = yield* WorkerHost.buildTestRunner(
      {
        options: spec.options,
        fileDescriptions: spec.fileDescriptions,
        sandboxWorkingDirectory: spec.sandboxWorkingDirectory,
        idGenerator: spec.idGenerator,
        retire: Effect.void,
        testFiles: spec.testFiles,
      },
      Effect.suspend(() =>
        testRunnerWorkerSpawnOf(spec.loadedPlugins, configuredPluginOf(spec.options.testRunner)).pipe(
          Effect.flatMap((resolved) =>
            WorkerHost.makeChildProcessTestRunner({
              options: spec.options,
              fileDescriptions: spec.fileDescriptions,
              sandboxWorkingDirectory: spec.sandboxWorkingDirectory,
              workerEntrypoint: resolved.entrypoint,
              idGenerator: spec.idGenerator,
            })
          ),
        )
      ),
    )
    yield* reports.report('testRunner', (yield* Clock.currentTimeMillis) - startedAt)
    return runner
  })
  return yield* Pool.makeWithTTL({
    acquire: acquireOne,
    min: spec.min,
    max: spec.max,
    timeToLive: IDLE_TIME_TO_LIVE,
  })
})

const TestRunnerPools = Blueprint.make<TestRunnerPoolSpec>()(TypeId).steps({
  steps: {},
  targets: { scoped: acquire },
})

export type TestRunnerPoolBlueprint = Blueprint.Of<typeof TestRunnerPools>

export const scoped = (
  spec: TestRunnerPoolSpec,
): Effect.Effect<
  Pool.Pool<WorkerHost.PooledTestRunner, Run.StageError | Workers.PooledTestRunnerError>,
  never,
  | Scope.Scope
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Workers.WorkerLauncher
  | Run.WorkerReports
> => TestRunnerPools.of(spec).scoped
