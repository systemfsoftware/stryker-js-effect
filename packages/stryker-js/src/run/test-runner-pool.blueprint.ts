import { Blueprint } from '@systemfsoftware/effect-cell-types'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Pool from 'effect/Pool'
import type * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import type { PooledTestRunner } from '../pooled-test-runner.handle.js'
import { StageError } from '../Run.schema.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from '../run/resolve-configured-plugin.workflow.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.blueprint.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { testRunnerConfigOf } from '../vm-runner.js'
import { type IdGeneratorShape } from '../Worker.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/TestRunnerPoolBlueprint')
export type TypeId = typeof TypeId

export interface TestRunnerPoolSpec {
  readonly options: Options.StrykerOptions
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly sandboxWorkingDirectory: string
  readonly idGenerator: IdGeneratorShape
  readonly testFiles: readonly string[]
  readonly loadedPlugins: Pick<LoadedPlugins, 'pluginSources'>
  readonly min: number
  readonly max: number
}

const IDLE_TIME_TO_LIVE = Duration.minutes(1)

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(testRunnerConfigOf(configured)).pipe(
    Match.when(Options.isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const testRunnerWorkerSpawnOf = (
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(
        WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind: 'TestRunner', configured }),
      ),
    ),
    (missing) =>
      StageError.make({
        stage: 'mutationTest',
        reason: missing.reason,
        cause: PluginNotFoundError.make({ descriptor: missing.descriptor }),
      }),
  )

const acquire: (
  spec: TestRunnerPoolSpec,
) => Effect.Effect<
  Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError>,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | WorkerLauncher
> = Effect.fnUntraced(function*(spec: TestRunnerPoolSpec) {
  return yield* Pool.makeWithTTL({
    acquire: buildTestRunner(
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
            makeChildProcessTestRunner({
              options: spec.options,
              fileDescriptions: spec.fileDescriptions,
              sandboxWorkingDirectory: spec.sandboxWorkingDirectory,
              workerEntrypoint: resolved.entrypoint,
              idGenerator: spec.idGenerator,
            })
          ),
        )
      ),
    ),
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
  Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError>,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | WorkerLauncher
> => TestRunnerPools.of(spec).scoped
