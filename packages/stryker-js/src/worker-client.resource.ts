import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { layerTraceContextClient, WorkerOptionsWire } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { clientLayer } from './spawned-socket-worker.handle.js'
import type { WorkerBootError } from './Worker.schema.js'
import { WorkerBootTimeoutError } from './Worker.schema.js'
import { WorkerLauncher } from './WorkerLauncher.service.js'

const connectRetry = Schedule.max([Schedule.spaced(50), Schedule.recurs(100)])

export interface WorkerClientParams<Rpcs extends Rpc.Any> {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
  readonly options: StrykerOptions
  readonly entrypoint: string
  readonly workingDirectory: string
  readonly execArgv: readonly string[]
  readonly tempDirPrefix: string
  readonly env?: Readonly<Record<string, string>> | undefined
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
    const optionsJson = yield* S.encodeEffect(WorkerOptionsWire)(params.options).pipe(Effect.orDie)
    const worker = yield* launcher.spawn({
      entrypoint: params.entrypoint,
      workingDirectory: params.workingDirectory,
      execArgv: params.execArgv,
      optionsJson,
      tempDirPrefix: params.tempDirPrefix,
      env: params.env,
    })

    const protocol = yield* worker.pipe(
      clientLayer,
      Layer.build,
      Effect.retry(connectRetry),
      Effect.raceFirst(worker.exited),
      Effect.catchTag('SocketError', () => Effect.fail(WorkerBootTimeoutError.make({ pid: worker.pid }))),
    )
    const traceContext = yield* Layer.build(layerTraceContextClient)

    return yield* RpcClient.make(params.rpcs).pipe(
      Effect.provideContext(Context.merge(protocol, traceContext)),
    )
  })
