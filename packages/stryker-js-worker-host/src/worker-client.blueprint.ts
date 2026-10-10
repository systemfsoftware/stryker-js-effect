import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { Workers } from '@systemfsoftware/stryker-js-contracts'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace, Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Rpc from 'effect/rpc/Rpc'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/WorkerClient')
export type TypeId = typeof TypeId

export const WORKER_BOOT_TIMEOUT = Duration.seconds(30)

export interface WorkerClientParams<Rpcs extends Rpc.Any> {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
  readonly options: Options.StrykerOptions
  readonly entrypoint: string
  readonly workingDirectory: string
  readonly execArgv: readonly string[]
  readonly tempDirPrefix: string
  readonly env?: Readonly<Record<string, string>> | undefined
}

const WorkerClients = <Rpcs extends Rpc.Any>() =>
  Blueprint.make<WorkerClientParams<Rpcs>>()(TypeId).steps({
    steps: {},
    targets: {
      scoped: Effect.fnUntraced(function*(params: WorkerClientParams<Rpcs>) {
        const launcher = yield* Workers.WorkerLauncher
        const optionsJson = yield* S.encodeEffect(Worker.WorkerOptionsWire)(params.options).pipe(Effect.orDie)
        const worker = yield* launcher.spawn({
          entrypoint: params.entrypoint,
          workingDirectory: params.workingDirectory,
          execArgv: params.execArgv,
          optionsJson,
          tempDirPrefix: params.tempDirPrefix,
          env: params.env,
        })
        const bootTimedOut = () => Effect.fail(Workers.WorkerBootTimeoutError.make({ pid: worker.pid }))
        const protocol = yield* worker.pipe(
          Workers.clientLayer,
          Layer.build,
          Effect.raceFirst(worker.exited),
          Effect.timeoutOrElse({ duration: WORKER_BOOT_TIMEOUT, orElse: bootTimedOut }),
          Effect.catchTag('SocketError', bootTimedOut),
        )
        const traceContext = yield* Layer.build(Trace.layerTraceContextClient)

        return yield* RpcClient.make(params.rpcs).pipe(
          Effect.provideContext(Context.merge(protocol, traceContext)),
        )
      }),
    },
  })

export const makeWorkerClient = <Rpcs extends Rpc.Any>(
  params: WorkerClientParams<Rpcs>,
): Effect.Effect<
  RpcClient.RpcClient<Rpcs, RpcClientError>,
  Workers.WorkerBootError,
  Scope.Scope | Workers.WorkerLauncher
> => WorkerClients<Rpcs>().of(params).scoped
