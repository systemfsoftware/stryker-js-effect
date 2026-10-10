import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Differential } from '@systemfsoftware/differential-spec'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { TypeQuery, type TypeQuerySite } from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

const FIXTURE = decodeURIComponent(new URL('__fixtures__/type-query/', import.meta.url).pathname)
const SITES_FILE = `${FIXTURE}sites.ts`
const TSCONFIG_FILE = `${FIXTURE}tsconfig.json`

interface Site {
  readonly siteId: string
  readonly line: number
  readonly text: string
}

interface Row {
  readonly id: string
  readonly site: Site
  readonly candidate: string
}

const UNION: Site = { siteId: 'union', line: 1, text: `'a'` }
const TUPLE: Site = { siteId: 'tuple', line: 3, text: `['x']` }
const GENERIC: Site = { siteId: 'generic', line: 5, text: `'x'` }
const NUMBER: Site = { siteId: 'number', line: 6, text: '1' }
const BOOLEAN: Site = { siteId: 'boolean', line: 7, text: 'true' }

const CANDIDATES: ReadonlyArray<readonly [Site, ReadonlyArray<string>]> = [
  [UNION, ['""', '"b"', '0', 'null', 'true', '{}', '`a`']],
  [TUPLE, ['[]', '""', '0', 'undefined']],
  [GENERIC, ['""', '0', 'null']],
  [NUMBER, ['""', '0', '-1', '1n', 'true', 'null', 'undefined', '() => undefined', '() => {}']],
  [BOOLEAN, ['false', '0', '""', 'undefined', '{}']],
]

const ROWS: ReadonlyArray<Row> = CANDIDATES.flatMap(([site, candidates]) =>
  candidates.map((candidate) => ({ site, candidate }))
).map((row, index) => ({ ...row, id: index.toString(16).padStart(16, '0') }))

const locationOf = (content: string, site: Site): TypeQuerySite['location'] => {
  const column = (content.split('\n')[site.line - 1] ?? '').lastIndexOf(site.text) + 1
  return { start: { line: site.line, column }, end: { line: site.line, column: column + site.text.length } }
}

const sitesContent = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(SITES_FILE))

const verdictsOf = (rows: ReadonlyArray<Row>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* sitesContent
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: TSCONFIG_FILE })
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(
      rows.map((row) => ({
        id: row.id,
        fileName: SITES_FILE,
        mutatorName: 'TypeQueryCandidate',
        replacement: row.candidate,
        location: locationOf(content, row.site),
      })),
    )
    const results = yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker
      return yield* checker.check([...wires])
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        Option.match(HashMap.get(results, row.id), { onNone: () => 'missing', onSome: (result) => result.status }),
      ]),
    )
  }).pipe(Effect.provide(FILE_PORTS), Effect.orDie)

const answersOf = (rows: ReadonlyArray<Row>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* sitesContent
    const bySite = Arr.groupBy(rows, (row) => row.site.siteId)
    const typeQuery = yield* TypeQuery
    const response = yield* typeQuery.query({
      version: 1,
      tsconfigFile: TSCONFIG_FILE,
      files: [{
        fileName: SITES_FILE,
        content,
        sites: Object.values(bySite).map((siteRows) => ({
          siteId: siteRows[0].site.siteId,
          location: locationOf(content, siteRows[0].site),
          candidates: siteRows.map((row) => ({ candidateId: row.id, text: row.candidate })),
        })),
      }],
    })
    return Object.fromEntries(
      response.files.flatMap((outcome): ReadonlyArray<readonly [string, string]> =>
        Match.valueTags(outcome, {
          FileRefused: (refused) => rows.map((row) => [row.id, `FileRefused ${refused.reason}`] as const),
          FileAnswered: (answered) =>
            answered.sites.flatMap((site) =>
              site.candidates.map((candidate) =>
                [
                  candidate.candidateId,
                  Match.valueTags(candidate.answer, {
                    Assignable: () => 'Assignable',
                    NotAssignable: () => 'NotAssignable',
                    Unknown: (unknown) => `Unknown ${unknown.reason}`,
                  }),
                ] as const
              )
            ),
        })
      ),
    )
  }).pipe(Effect.provide(TypeQueryLive), Effect.scoped, Effect.provide(FILE_PORTS), Effect.orDie)

const HOST_BOUND = {
  timeout: 120_000,
  reason: 'the reference builds a real tsgo checker program and the candidate runs a tsgo API server, both on disk',
} as const

Differential.compare({
  name: 'type query: every candidate answered NotAssignable is a CompileError when the checker applies it',
  reference: verdictsOf,
  candidate: answersOf,
})
  .on(fc.subarray([...ROWS], { minLength: 1 }), { runBudget: 6, hostBound: HOST_BOUND })
  .assert((verdicts, answers) =>
    Object.keys(verdicts).length === Object.keys(answers).length &&
    Object.entries(answers).every(([id, answer]) => answer !== 'NotAssignable' || verdicts[id] === 'compileError')
  )
