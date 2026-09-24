import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'
import { type SpawnedSocketWorker } from './spawned-socket-worker.handle.js'
import type { ChildProcessCrashedError } from './Worker.schema.js'

export interface WorkerSpawnParams {
  readonly entrypoint: string
  readonly workingDirectory: string
  readonly execArgv: readonly string[]
  readonly optionsJson: string
  readonly tempDirPrefix: string
  readonly env?: Readonly<Record<string, string>> | undefined
}

export interface WorkerLauncherShape {
  readonly spawn: (
    params: WorkerSpawnParams,
  ) => Effect.Effect<SpawnedSocketWorker, ChildProcessCrashedError, Scope.Scope>
}

export class WorkerLauncher extends Context.Service<WorkerLauncher, WorkerLauncherShape>()(
  '@systemfsoftware/stryker-js/WorkerLauncher.service/WorkerLauncher',
) {}
