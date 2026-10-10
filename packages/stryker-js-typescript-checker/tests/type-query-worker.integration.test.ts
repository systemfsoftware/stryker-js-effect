import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, Worker } from '@systemfsoftware/stryker-js'
import { Checker, Options, Plugin, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'

const Feature = makeFeature({ it })

const FIXTURE_URL = new URL('./__fixtures__/worker-answers-type-query/', import.meta.url)
const WORKER_ENTRYPOINT = new URL('../dist/main.mjs', import.meta.url).href
const WORKING_DIRECTORY_URL = new URL('../', import.meta.url)

const BROKEN_ID = '00000000000000b1'
const PASSED_ID = '00000000000000b2'

interface Fixture {
  readonly tsconfigFile: string
  readonly sourceFile: string
  readonly outsideFile: string
  readonly source: string
  readonly outside: string
}

const fixture: Effect.Effect<Fixture, never, FileSystem.FileSystem | Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const directory = yield* path.fromFileUrl(FIXTURE_URL)
  const sourceFile = path.join(directory, 'source.ts')
  const outsideFile = path.join(directory, 'outside.ts')
  return {
    tsconfigFile: path.join(directory, 'tsconfig.json'),
    sourceFile,
    outsideFile,
    source: yield* fs.readFileString(sourceFile),
    outside: yield* fs.readFileString(outsideFile),
  }
}).pipe(Effect.orDie)

const makeClient = Effect.gen(function*() {
  const path = yield* Path.Path
  const options = Result.getOrThrow(
    S.decodeResult(Options.StrykerOptionsSchema)({
      tsconfigFile: (yield* fixture).tsconfigFile,
      typescriptChecker: {},
    }),
  )
  return yield* Worker.makeWorkerClient({
    rpcs: Plugin.CheckerRpcs,
    options,
    entrypoint: WORKER_ENTRYPOINT,
    workingDirectory: yield* path.fromFileUrl(WORKING_DIRECTORY_URL),
    execArgv: [],
    tempDirPrefix: 'stryker-checker-type-query-',
  })
}).pipe(Effect.orDie)

const locationOf = (content: string, line: number, text: string): TypeQuery.TypeQuerySite['location'] => {
  const column = (content.split('\n')[line - 1] ?? '').lastIndexOf(text) + 1
  return { start: { line, column }, end: { line, column: column + text.length } }
}

const requestOf = (project: Fixture): TypeQuery.TypeQueryRequest => ({
  version: 1,
  tsconfigFile: project.tsconfigFile,
  files: [
    {
      fileName: project.sourceFile,
      content: project.source,
      sites: [
        {
          siteId: 'union',
          kind: 'expression',
          location: locationOf(project.source, 2, `'a'`),
          candidates: [{ candidateId: '""', text: '""' }],
        },
        {
          siteId: 'call',
          kind: 'expression',
          location: locationOf(project.source, 11, `{ capture: 'x' }`),
          candidates: [{ candidateId: '{}', text: '{}' }],
        },
      ],
    },
    { fileName: project.outsideFile, content: project.outside, sites: [] },
  ],
})

const wiresOf = (project: Fixture) => [
  {
    id: BROKEN_ID,
    fileName: project.sourceFile,
    mutatorName: 'StringLiteral',
    replacement: '""',
    location: locationOf(project.source, 2, `'a'`),
  },
  {
    id: PASSED_ID,
    fileName: project.sourceFile,
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    location: locationOf(project.source, 5, 'true'),
  },
]

const inProcessQuery = (
  request: TypeQuery.TypeQueryRequest,
): Effect.Effect<TypeQuery.TypeQueryResponse, TypeQuery.TypeQueryRefused, Scope.Scope> =>
  Effect.provide(
    Effect.gen(function*() {
      const typeQuery = yield* TypeQuery.TypeQuery
      return yield* typeQuery.query(request)
    }),
    TypeQueryLive,
  )

const answerFacts = (answer: TypeQuery.TypeAnswer): { readonly tag: string; readonly candidateType: string } =>
  Match.valueTags(answer, {
    Assignable: (assignable) => ({ tag: 'Assignable', candidateType: assignable.candidateType }),
    NotAssignable: (notAssignable) => ({ tag: 'NotAssignable', candidateType: notAssignable.candidateType }),
    Unknown: (unknown) => ({ tag: `Unknown ${unknown.reason}`, candidateType: '' }),
  })

type AnswerSummary = Readonly<Record<string, { readonly tag: string; readonly candidateType: string }>>

const answersOf = (response: TypeQuery.TypeQueryResponse): AnswerSummary =>
  Object.fromEntries(
    response.files.flatMap((
      outcome,
    ): ReadonlyArray<readonly [string, { readonly tag: string; readonly candidateType: string }]> =>
      Match.valueTags(outcome, {
        FileAnswered: (answered) =>
          answered.sites.flatMap((site) =>
            site.candidates.map((
              candidate,
            ): readonly [string, { readonly tag: string; readonly candidateType: string }] => [
              `${site.siteId} ${candidate.candidateId}`,
              answerFacts(candidate.answer),
            ])
          ),
        FileRefused: () => [],
      })
    ),
  )

const refusalsOf = (response: TypeQuery.TypeQueryResponse): ReadonlyArray<{ readonly reason: string }> =>
  response.files.flatMap((outcome): ReadonlyArray<{ readonly reason: string }> =>
    Match.valueTags(outcome, {
      FileAnswered: () => [],
      FileRefused: (refused) => [{ reason: refused.reason }],
    })
  )

const servingFacts = (
  serving: TypeQuery.TypeQueryServing,
): {
  readonly tag: string
  readonly version: number
  readonly declared: ReadonlyArray<number>
  readonly nextAction: string
} =>
  Match.valueTags(serving, {
    TypeQueryServed: (served) => ({ tag: 'TypeQueryServed', version: served.version, declared: [], nextAction: '' }),
    TypeQueryNotServed: (notServed) => ({
      tag: 'TypeQueryNotServed',
      version: notServed.version,
      declared: notServed.declared,
      nextAction: notServed.nextAction,
    }),
  })

const ppidOf = (pid: number): Effect.Effect<number | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const stat = yield* fs.readFileString(`/proc/${pid}/stat`).pipe(Effect.orElseSucceed(() => ''))
    const closing = stat.lastIndexOf(')')
    return closing === -1 ? undefined : Number(stat.slice(closing + 2).split(' ')[1])
  }).pipe(Effect.orDie)

const descendantPids = (root: number): Effect.Effect<ReadonlyArray<number>, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const names = yield* fs.readDirectory('/proc')
    const pairs = yield* Effect.forEach(
      names.filter((name) => /^\d+$/u.test(name)),
      (name) => Effect.map(ppidOf(Number(name)), (ppid) => ({ pid: Number(name), ppid })),
      { concurrency: 'unbounded' },
    )
    const collected: Array<number> = []
    const frontier: Array<number> = [root]
    for (const parent of frontier) {
      for (const pair of pairs) {
        if (pair.ppid === parent && !collected.includes(pair.pid)) {
          collected.push(pair.pid)
          frontier.push(pair.pid)
        }
      }
    }
    return collected
  }).pipe(Effect.orDie)

const ownPid: Effect.Effect<number, never, FileSystem.FileSystem> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const target = yield* fs.readLink('/proc/self')
  const parts = target.split('/')
  return Number(parts[parts.length - 1])
}).pipe(Effect.orDie)

const tsgoServerCount: Effect.Effect<number, never, FileSystem.FileSystem> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const pids = yield* descendantPids(yield* ownPid)
  const openings = yield* Effect.forEach(
    pids,
    (pid) =>
      fs.readFileString(`/proc/${pid}/cmdline`).pipe(
        Effect.map((cmdline) => (cmdline.includes('--api') ? 1 : 0)),
        Effect.orElseSucceed(() => 0),
      ),
    { concurrency: 'unbounded' },
  )
  return openings.reduce((total, opening) => total + opening, 0)
}).pipe(Effect.orDie)

const settleToZero = (budget: number): Effect.Effect<number, never, FileSystem.FileSystem> =>
  tsgoServerCount.pipe(
    Effect.filterOrElse(
      (count) => count === 0 || budget <= 0,
      () => Effect.flatMap(Effect.sleep('100 millis'), () => settleToZero(budget - 1)),
    ),
  )

const declaredServing: Effect.Effect<
  {
    readonly declared: ReadonlyArray<number>
    readonly served: ReadonlyArray<string | number>
    readonly servedTwo: ReadonlyArray<string | number>
    readonly emptyTag: string
    readonly emptyVersion: number
    readonly emptyNextAction: boolean
    readonly emptyDeclared: ReadonlyArray<number>
    readonly strippedTag: string
    readonly strippedVersion: number
    readonly strippedNextAction: boolean
    readonly strippedDeclared: ReadonlyArray<number>
    readonly strippedTwo: ReadonlyArray<string | number | ReadonlyArray<number>>
    readonly unknownIsUnknownChecker: boolean
  },
  never,
  FileSystem.FileSystem | Path.Path | Worker.WorkerLauncher | Scope.Scope
> = Effect.gen(function*() {
  const client = yield* makeClient
  const capabilities = yield* client.capabilities({ checkerName: 'typescript' }).pipe(Effect.orDie)
  const served = servingFacts(TypeQuery.typeQueryServingOf(capabilities, 1))
  const servedTwo = servingFacts(TypeQuery.typeQueryServingOf(capabilities, 2))
  const empty = servingFacts(TypeQuery.typeQueryServingOf({ typeQuery: [] }, 1))
  const stripped = servingFacts(
    TypeQuery.typeQueryServingOf({ typeQuery: capabilities.typeQuery.filter((version) => version !== 1) }, 1),
  )
  const strippedTwo = servingFacts(
    TypeQuery.typeQueryServingOf({ typeQuery: capabilities.typeQuery.filter((version) => version !== 2) }, 2),
  )
  const unknown = yield* Effect.flip(client.capabilities({ checkerName: 'ruby' }))
  return {
    declared: capabilities.typeQuery,
    served: [served.tag, served.version],
    servedTwo: [servedTwo.tag, servedTwo.version],
    emptyTag: empty.tag,
    emptyVersion: empty.version,
    emptyNextAction: empty.nextAction.length > 0,
    emptyDeclared: empty.declared,
    strippedTag: stripped.tag,
    strippedVersion: stripped.version,
    strippedNextAction: stripped.nextAction.length > 0,
    strippedDeclared: stripped.declared,
    strippedTwo: [strippedTwo.tag, strippedTwo.version, strippedTwo.declared],
    unknownIsUnknownChecker: String(unknown).includes('does not exist'),
  }
}).pipe(Effect.orDie)

const workerVersusInProcess: Effect.Effect<
  { readonly worker: TypeQuery.TypeQueryResponse; readonly inProcess: TypeQuery.TypeQueryResponse },
  never,
  FileSystem.FileSystem | Path.Path | Worker.WorkerLauncher | Scope.Scope
> = Effect.gen(function*() {
  const request = requestOf(yield* fixture)
  const client = yield* makeClient
  const worker = yield* client.typeQuery(request).pipe(Effect.orDie)
  const inProcess = yield* inProcessQuery(request).pipe(Effect.orDie)
  return { worker, inProcess }
}).pipe(Effect.orDie)

const checkAroundQuery: Effect.Effect<
  { readonly before: Record<string, Checker.CheckAnswer>; readonly after: Record<string, Checker.CheckAnswer> },
  never,
  FileSystem.FileSystem | Path.Path | Worker.WorkerLauncher | Scope.Scope
> = Effect.gen(function*() {
  const project = yield* fixture
  const client = yield* makeClient
  const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(wiresOf(project)).pipe(Effect.orDie)
  const check = client.check({ checkerName: 'typescript', mutants: [...wires] }).pipe(Effect.orDie)
  const before = yield* check
  yield* client.typeQuery(requestOf(project)).pipe(Effect.orDie)
  const after = yield* check
  return { before, after }
}).pipe(Effect.orDie)

const statusesOf = (results: Record<string, Checker.CheckAnswer>): Record<string, string | undefined> => ({
  [BROKEN_ID]: results[BROKEN_ID]?.status,
  [PASSED_ID]: results[PASSED_ID]?.status,
})

const scopeBoundsTheQueryServer: Effect.Effect<
  { readonly opened: number; readonly after: number },
  never,
  FileSystem.FileSystem | Path.Path | Worker.WorkerLauncher | Scope.Scope
> = Effect.gen(function*() {
  const before = yield* tsgoServerCount
  const during = yield* Effect.scoped(
    Effect.gen(function*() {
      const client = yield* makeClient
      yield* client.capabilities({ checkerName: 'typescript' }).pipe(Effect.orDie)
      const idle = yield* tsgoServerCount
      yield* client.typeQuery(requestOf(yield* fixture)).pipe(Effect.orDie)
      return { idle, opened: yield* tsgoServerCount }
    }),
  )
  const after = yield* settleToZero(100)
  return { opened: during.opened - during.idle, after: after - before }
}).pipe(Effect.orDie)

Feature('Serving type queries over the checker worker’s RPC group', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the packed worker bundle, real tsgo servers, and the real child processes they spawn')
  .body(({ scenario }) => {
    scenario(
      'The worker names the type-query versions it serves, and a caller is refused a version the worker does not declare',
      Gherkin.Do.pipe(
        When(
          'the worker declares its type-query versions, and the caller asks for each version with and without it declared',
        )(
          'serving',
          () => declaredServing,
        ),
        Then(
          'each version is served when declared, not served with that version and a next action otherwise, and unknown checkers fail',
        )((
          s,
          expect,
        ) =>
          expect(s.serving).toEqual({
            declared: [1, 2],
            served: ['TypeQueryServed', 1],
            servedTwo: ['TypeQueryServed', 2],
            emptyTag: 'TypeQueryNotServed',
            emptyVersion: 1,
            emptyNextAction: true,
            emptyDeclared: [],
            strippedTag: 'TypeQueryNotServed',
            strippedVersion: 1,
            strippedNextAction: true,
            strippedDeclared: [2],
            strippedTwo: ['TypeQueryNotServed', 2, [1]],
            unknownIsUnknownChecker: true,
          })
        ),
      ),
    )

    scenario(
      'A type query served over the worker answers exactly as the in-process server, refusing a file outside the project',
      Gherkin.Do.pipe(
        When('the same request is served by the worker and in process')('responses', () => workerVersusInProcess),
        Then('the worker response is the in-process response')((s, expect) =>
          expect(s.responses.worker).toEqual(s.responses.inProcess)
        ),
        When('the worker response is summarised')('facts', (s) =>
          Effect.succeed({
            answers: answersOf(s.responses.worker),
            refusals: refusalsOf(s.responses.worker),
          })),
        Then(
          'the literal union and the call argument are NotAssignable and the outside file is refused not-in-project',
        )((
          s,
          expect,
        ) =>
          expect(s.facts).toEqual({
            answers: {
              'union ""': { tag: 'NotAssignable', candidateType: '""' },
              'call {}': { tag: 'NotAssignable', candidateType: '{}' },
            },
            refusals: [{ reason: 'not-in-project' }],
          })
        ),
      ),
    )

    scenario(
      'Checking the same mutants answers identically before and after a type query',
      Gherkin.Do.pipe(
        When('the mutants are checked, a query is served, and the mutants are checked again')(
          'checks',
          () => checkAroundQuery,
        ),
        Then('both checks agree')((s, expect) => expect(s.checks.after).toEqual(s.checks.before)),
        When('the first check’s verdicts are read')('verdicts', (s) => Effect.succeed(statusesOf(s.checks.before))),
        Then('the verdicts are the usual compile error and pass')((s, expect) =>
          expect(s.verdicts).toEqual({
            [BROKEN_ID]: 'compileError',
            [PASSED_ID]: 'passed',
          })
        ),
      ),
    )

    scenario(
      'Closing the worker scope ends the query tsgo process',
      Gherkin.Do.pipe(
        When('a query opens its server inside a scope that then closes')('seen', () => scopeBoundsTheQueryServer),
        Then('exactly one tsgo server opens and none survive the scope')((s, expect) =>
          expect(s.seen).toEqual({ opened: 1, after: 0 })
        ),
      ),
    )
  })
