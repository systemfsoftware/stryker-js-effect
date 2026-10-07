import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const REJECTED_FILE = 'src/lib/rejected.ts'
const REJECTION_REASON = 'rejected by the fixture checker'
const IGNORED_FILE = 'src/lib/ignored.ts'
const IGNORE_REASON = 'ignored by the fixture checker'

const isFile = (mutant, file) => mutant.fileName === file || mutant.fileName.endsWith(`/${file}`)

const answerOf = (mutant) => {
  if (isFile(mutant, REJECTED_FILE)) {
    return { status: 'compileError', reason: REJECTION_REASON }
  }
  if (isFile(mutant, IGNORED_FILE)) {
    return { status: 'ignored', reason: IGNORE_REASON }
  }
  return { status: 'passed' }
}

const CHECK_DELAY = '25 millis'

const handlers = Plugin.CheckerRpcs.toLayer({
  group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
  check: ({ mutants }) =>
    Effect.as(
      Effect.sleep(CHECK_DELAY),
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
