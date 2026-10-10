import { NodeFileSystem, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createHash } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const PROGRAM_FILES = ['src/lib/chain.ts', 'src/lib/subject.ts', 'src/types/transitive.d.ts']

const CONFIG_FILE = 'tsconfig.json'

const MUTATED_FILE = 'src/lib/subject.ts'
const REJECTION_REASON = 'rejected by the fixture checker'
const CHAIN_FILE = 'src/lib/chain.ts'
const ACCEPT_ALL_MARKER = 'checker-accepts-all'
const DIGEST_SCOPES_FILE = '.checker-digest-scopes'

const relativeToCwd = (file) => relative(process.cwd(), resolve(file)).replaceAll('\\', '/')

const configFileChain = async () => {
  const files = []
  const seen = new Set()
  const pending = [CONFIG_FILE]
  while (pending.length > 0) {
    const configFile = pending.pop()
    if (seen.has(configFile)) {
      continue
    }
    seen.add(configFile)
    files.push(configFile)
    const config = JSON.parse(await readFile(configFile, 'utf8'))
    for (const specifier of [].concat(config.extends ?? [])) {
      pending.push(relativeToCwd(specifier))
    }
  }
  return files
}

const programDigestOf = async () => {
  const lines = []
  for (const file of [...PROGRAM_FILES, ...(await configFileChain())].sort()) {
    lines.push(`${file}\u0000${await readFile(file, 'utf8')}`)
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

const configDigestOf = async () => {
  const lines = []
  for (const file of (await configFileChain()).sort()) {
    lines.push(`${file}\u0000${await readFile(file, 'utf8')}`)
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

const rejects = (mutant) => mutant.fileName === MUTATED_FILE || mutant.fileName.endsWith(`/${MUTATED_FILE}`)

const answersOf = async (mutants) => {
  const acceptsAll = (await readFile(CHAIN_FILE, 'utf8')).includes(ACCEPT_ALL_MARKER)
  return Object.fromEntries(
    mutants.map((mutant) => [
      mutant.id,
      !acceptsAll && rejects(mutant) ? { status: 'compileError', reason: REJECTION_REASON } : { status: 'passed' },
    ]),
  )
}

const handlers = Plugin.CheckerRpcs.toLayer({
  group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
  digest: ({ scope }) =>
    Effect.promise(async () => {
      await appendFile(DIGEST_SCOPES_FILE, `${scope}\n`)
      return scope === 'config' ? configDigestOf() : programDigestOf()
    }),
  check: ({ mutants }) => Effect.promise(() => answersOf(mutants)),
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
