import { layerTraceContextClient } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import type * as Scope from 'effect/Scope'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import type * as Socket from 'effect/unstable/socket/Socket'

import { ChildProcessCrashedError, OutOfMemoryError, WorkerBootTimeoutError } from './Worker.schema.js'

export const connectRetry = Schedule.max([Schedule.spaced(50), Schedule.recurs(100)])

export type WorkerExit = ChildProcessCrashedError | OutOfMemoryError

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
}

export interface WorkerLauncherShape {
  readonly spawn: (
    params: WorkerSpawnParams,
  ) => Effect.Effect<SpawnedSocketWorker, ChildProcessCrashedError, Scope.Scope>
}

export class WorkerLauncher extends Context.Service<WorkerLauncher, WorkerLauncherShape>()(
  '@systemfsoftware/stryker-js-engine/WorkerLauncher',
) {}

export type WorkerBootError = WorkerExit | WorkerBootTimeoutError

export interface WorkerClientParams<Rpcs extends Rpc.Any> extends WorkerSpawnParams {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
}

export const makeWorkerClient = <Rpcs extends Rpc.Any>(
  params: WorkerClientParams<Rpcs>,
): Effect.Effect<
  RpcClient.RpcClient<Rpcs, RpcClientError>,
  WorkerBootError,
  Scope.Scope | WorkerLauncher
> =>
  Effect.gen(function*() {
    const launcher = yield* WorkerLauncher
    const worker = yield* launcher.spawn({
      entrypoint: params.entrypoint,
      workingDirectory: params.workingDirectory,
      execArgv: params.execArgv,
      optionsJson: params.optionsJson,
      tempDirPrefix: params.tempDirPrefix,
    })

    const protocol = yield* Layer.build(worker.clientLayer).pipe(
      Effect.retry(connectRetry),
      Effect.raceFirst(worker.exited),
      Effect.catchTag('SocketError', () => Effect.fail(WorkerBootTimeoutError.make({ pid: worker.pid }))),
    )

    return yield* RpcClient.make(params.rpcs).pipe(
      Effect.provideContext(protocol),
      Effect.provide(layerTraceContextClient),
    )
  })
