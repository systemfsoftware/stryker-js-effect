import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import * as Pool from 'effect/Pool'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'

import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import { WorkerReports } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { PhaseClock } from '../run/phase-clock.service.js'
import {
  ConfiguredPluginModulePath,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from '../run/resolve-configured-plugin.workflow.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { type CheckerPool, isCheckerCrash } from './checker-pool.handle.js'
import { scoped as checkerScoped } from './Checker.blueprint.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/CheckerPoolBlueprint')
export type TypeId = typeof TypeId

export interface CheckerPoolSpec {
  readonly options: Options.StrykerOptions
  readonly loadedPlugins: Pick<LoadedPlugins, 'pluginSources'>
  readonly size: number
  readonly workingDirectory: string
}

const CHECKER_ACQUIRE_RETRIES = 2

const checkerWorkerSpawnOf = (
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  configured: ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind: 'Checker', configured })),
    ),
    (missing) =>
      StageError.make({
        stage: 'mutationTest',
        reason: missing.reason,
        cause: PluginNotFoundError.make({ descriptor: missing.descriptor }),
      }),
  )

const acquire = Effect.fnUntraced(function*(spec: CheckerPoolSpec) {
  const reports = yield* WorkerReports
  const phaseClock = yield* PhaseClock
  return yield* Boolean.match(spec.options.checkers.length === 0, {
    onTrue: (): Effect.Effect<CheckerPool | undefined, never, Scope.Scope> => Effect.as(Effect.void, undefined),
    onFalse: () =>
      Effect.andThen(
        phaseClock.markCheckersConfigured,
        Pool.make({
          acquire: Effect.forEach(spec.options.checkers, (checker) =>
            Effect.gen(function*() {
              const resolved = yield* checkerWorkerSpawnOf(
                spec.loadedPlugins,
                ConfiguredPluginModulePath.make({ modulePath: checker.plugin }),
              )
              const startedAt = yield* Clock.currentTimeMillis
              const service = yield* checkerScoped({
                options: { ...spec.options, checkers: [checker] },
                workerEntrypoint: resolved.entrypoint,
                workingDirectory: spec.workingDirectory,
              }).pipe(Effect.retry({ times: CHECKER_ACQUIRE_RETRIES, while: isCheckerCrash }))
              const endedAt = yield* Clock.currentTimeMillis
              yield* phaseClock.recordCheckerBusy({ startMs: startedAt, endMs: endedAt })
              yield* reports.report('checker', endedAt - startedAt)
              return { checkerName: resolved.name, checker: service }
            })),
          size: spec.size,
        }),
      ),
  })
})

const CheckerPools = Blueprint.make<CheckerPoolSpec>()(TypeId).steps({
  steps: {},
  targets: { scoped: acquire },
})

export type CheckerPoolBlueprint = Blueprint.Of<typeof CheckerPools>

export const scoped = (
  spec: CheckerPoolSpec,
): Effect.Effect<
  CheckerPool | undefined,
  never,
  | Scope.Scope
  | ChildProcessSpawner.ChildProcessSpawner
  | WorkerLauncher
  | FileSystem.FileSystem
  | Path.Path
  | PhaseClock
  | WorkerReports
> => CheckerPools.of(spec).scoped
