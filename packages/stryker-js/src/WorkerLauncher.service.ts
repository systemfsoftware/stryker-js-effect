import { ChildProcessCrashedError, OutOfMemoryError, WorkerBootTimeoutError } from './Worker.schema.js'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Scope from 'effect/Scope'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type * as Socket from 'effect/unstable/socket/Socket'

export type WorkerExit = ChildProcessCrashedError | OutOfMemoryError

export type WorkerBootError = WorkerExit | WorkerBootTimeoutError

export interface SpawnedSocketWorker {
  readonly pid: number
  readonly clientLayer: Layer.Layer<RpcClient.Protocol, Socket.SocketError>
  readonly exited: Effect.Effect<never, WorkerExit>
}

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