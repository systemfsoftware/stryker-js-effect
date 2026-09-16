import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import {
  CheckerRpcs,
  layerTraceContextServer,
  startWorkerTelemetry,
  withLinkedSpan,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import effectManifest from 'effect/package.json' with { type: 'json' }
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'

export const EFFECT_VERSION: string = effectManifest.version

const mutantIdsOf = (mutants: readonly { readonly id: string }[]): readonly string[] =>
  mutants.map((mutant) => mutant.id)

const CHECK_SPAN = 'skew.check'
const GROUP_SPAN = 'skew.group'

const checkerHandlers = CheckerRpcs.toLayer(
  Effect.succeed({
    check: ({ mutants }: { readonly mutants: readonly { readonly id: string }[] }) =>
      withLinkedSpan(
        CHECK_SPAN,
        { 'effect.version': EFFECT_VERSION },
        Effect.succeed(Object.fromEntries(mutantIdsOf(mutants).map((id) => [id, { status: 'passed' as const }]))),
      ),
    group: ({ mutants }: { readonly mutants: readonly { readonly id: string }[] }) =>
      withLinkedSpan(
        GROUP_SPAN,
        { 'effect.version': EFFECT_VERSION },
        Effect.succeed(mutantIdsOf(mutants).map((id) => [id])),
      ),
  }),
)

const mainLayer = (socketPath: string) =>
  RpcServer.layer(CheckerRpcs).pipe(
    Layer.provide(checkerHandlers),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(NodeSocketServer.layer({ path: socketPath })),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    Layer.provide(layerTraceContextServer),
  )

const socketPath = process.env['STRYKER_SOCKET']

if (socketPath !== undefined) {
  await startWorkerTelemetry()
  Effect.runFork(
    Layer.launch(mainLayer(socketPath)).pipe(
      Effect.provideService(Logger.LogToStderr, true),
      Effect.tapCause((cause: Cause.Cause<unknown>) =>
        Effect.sync(() => {
          process.stderr.write(`effect-skew checker worker: ${Cause.pretty(cause)}\n`)
          process.exitCode = 1
        })
      ),
    ),
  )
}
