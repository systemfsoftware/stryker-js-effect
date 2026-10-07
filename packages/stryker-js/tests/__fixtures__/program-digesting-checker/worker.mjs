import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const PROGRAM_FILES = ['tsconfig.json', 'src/lib/chain.ts', 'src/lib/subject.ts', 'src/types/transitive.d.ts']

const MUTATED_FILE = 'src/lib/subject.ts'
const REJECTION_REASON = 'rejected by the fixture checker'

const programDigestOf = async () => {
  const lines = []
  for (const file of [...PROGRAM_FILES].sort()) {
    lines.push(`${file}\u0000${await readFile(file, 'utf8')}`)
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

const answerOf = (mutant) =>
  mutant.fileName === MUTATED_FILE || mutant.fileName.endsWith(`/${MUTATED_FILE}`)
    ? { status: 'compileError', reason: REJECTION_REASON }
    : { status: 'passed' }

const handlers = Plugin.CheckerRpcs.toLayer({
  group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
  digest: () => Effect.promise(programDigestOf),
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
