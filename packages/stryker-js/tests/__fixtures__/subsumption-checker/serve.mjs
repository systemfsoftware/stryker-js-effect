import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const DOMINATOR_REPLACEMENT = 'a <= b'
const CHECK_DELAY = '5 millis'

export const serveChecker = (dominatorAnswer) => {
  const answerOf = (mutant) => mutant.replacement === DOMINATOR_REPLACEMENT ? dominatorAnswer : { status: 'passed' }
  const handlers = Plugin.CheckerRpcs.toLayer({
    group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
    digest: () => Effect.succeed('0123456789abcdef'.repeat(4)),
    capabilities: () => Effect.succeed({ typeQuery: [] }),
    typeQuery: () =>
      Effect.fail(
        TypeQuery.TypeQueryRefused.make({
          version: 2,
          reason: 'unsupported-version',
          nextAction:
            'This checker declares no type-query versions; send type queries to one whose capabilities list the version.',
        }),
      ),
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
}
