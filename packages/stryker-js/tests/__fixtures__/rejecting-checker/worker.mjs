import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const REJECTED_FILE = 'src/lib/rejected.ts'
const REJECTION_REASON = 'rejected by the fixture checker'

const answerOf = (mutant) =>
  mutant.fileName === REJECTED_FILE || mutant.fileName.endsWith(`/${REJECTED_FILE}`)
    ? { status: 'compileError', reason: REJECTION_REASON }
    : { status: 'passed' }

const PROGRAM_DIGEST = '0123456789abcdef'.repeat(4)
const CONFIG_DIGEST = 'fedcba9876543210'.repeat(4)

const handlers = Plugin.CheckerRpcs.toLayer({
  group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
  digest: ({ scope }) => Effect.succeed(scope === 'config' ? CONFIG_DIGEST : PROGRAM_DIGEST),
  check: ({ mutants }) =>
    Effect.succeed(
      Object.fromEntries(mutants.map((mutant) => [mutant.id, answerOf(mutant)])),
    ),
})

const platform = Layer.unwrap(
  Effect.gen(function*() {
    const socketPath = yield* Config.String('STRYKER_SOCKET')
    return Layer.merge(NodeSocketServer.layer({ path: socketPath }), NodeFileSystem.layer)
  }),
)

NodeRuntime.runMain(
  Worker.workerServerLayer({ rpcs: Plugin.CheckerRpcs, handlers, schemaServices: Layer.empty }).pipe(
    Layer.provide(platform),
    Layer.launch,
  ),
)
