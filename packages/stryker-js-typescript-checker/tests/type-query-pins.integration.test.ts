import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  type FileOutcome,
  type SiteAnswer,
  type TypeAnswer,
  TypeQuery,
  type TypeQueryFile,
  type TypeQueryRefused,
  type TypeQueryRequest,
  type TypeQueryResponse,
  type TypeQuerySite,
} from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

type HostPorts = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

interface SiteSpec {
  readonly siteId: string
  readonly line: number
  readonly text: string
  readonly candidates: ReadonlyArray<string>
}

interface Fixture {
  readonly directory: string
  readonly tsconfigFile: string
  readonly file: (name: string) => string
}

const fixtureOf = (name: string): Effect.Effect<Fixture, never, Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const here = yield* Effect.orDie(path.fromFileUrl(new URL(import.meta.url)))
    const directory = path.join(path.dirname(here), '__fixtures__', name)
    return {
      directory,
      tsconfigFile: path.join(directory, 'tsconfig.json'),
      file: (file) => path.join(directory, file),
    }
  })

const locationOf = (content: string, line: number, text: string): TypeQuerySite['location'] => {
  const column = (content.split('\n')[line - 1] ?? '').lastIndexOf(text) + 1
  return { start: { line, column }, end: { line, column: column + text.length } }
}

const queryFileOf = (fileName: string, content: string, sites: ReadonlyArray<SiteSpec>): TypeQueryFile => ({
  fileName,
  content,
  sites: sites.map((site) => ({
    siteId: site.siteId,
    location: locationOf(content, site.line, site.text),
    candidates: site.candidates.map((text) => ({ candidateId: text, text })),
  })),
})

const readQueryFile = (
  fixture: Fixture,
  name: string,
  sites: ReadonlyArray<SiteSpec>,
): Effect.Effect<TypeQueryFile, never, FileSystem.FileSystem> =>
  Effect.map(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(fixture.file(name)))),
    (content) => queryFileOf(fixture.file(name), content, sites),
  )

const answerText = (answer: TypeAnswer): string =>
  Match.valueTags(answer, {
    Assignable: (assignable) => `Assignable ${assignable.candidateType}`,
    NotAssignable: (notAssignable) => `NotAssignable ${notAssignable.candidateType} to ${notAssignable.contextualType}`,
    Unknown: (unknown) => `Unknown ${unknown.reason}`,
  })

const siteAnswersOf = (site: SiteAnswer): ReadonlyArray<readonly [string, string]> =>
  site.candidates.map((candidate) => [`${site.siteId} ${candidate.candidateId}`, answerText(candidate.answer)])

const outcomeText = (outcome: FileOutcome): Readonly<Record<string, string>> =>
  Match.valueTags(outcome, {
    FileRefused: (refused) => ({ [refused.fileName]: `FileRefused ${refused.reason}` }),
    FileAnswered: (answered) => Object.fromEntries(answered.sites.flatMap(siteAnswersOf)),
  })

const contextualTypesOf = (outcome: FileOutcome): Readonly<Record<string, string>> =>
  Match.valueTags(outcome, {
    FileRefused: () => ({}),
    FileAnswered: (answered) =>
      Object.fromEntries(
        answered.sites.map((site) => [site.siteId, Option.getOrElse(site.contextualType, () => 'none')] as const),
      ),
  })

const query = (request: TypeQueryRequest): Effect.Effect<TypeQueryResponse, TypeQueryRefused> =>
  Effect.gen(function*() {
    const typeQuery = yield* TypeQuery
    return yield* typeQuery.query(request)
  }).pipe(Effect.provide(TypeQueryLive), Effect.scoped)

const requestOf = (fixture: Fixture, files: TypeQueryRequest['files']): TypeQueryRequest => ({
  version: 1,
  tsconfigFile: fixture.tsconfigFile,
  files,
})

const SITES: ReadonlyArray<SiteSpec> = [
  { siteId: 'union', line: 1, text: `'a'`, candidates: ['""', '"b"'] },
  { siteId: 'tuple', line: 3, text: `['x']`, candidates: ['[]'] },
  { siteId: 'generic', line: 5, text: `'x'`, candidates: ['""'] },
]

const answeredSites = Effect.gen(function*() {
  const fixture = yield* fixtureOf('type-query')
  const file = yield* readQueryFile(fixture, 'sites.ts', SITES)
  const response = yield* Effect.orDie(query(requestOf(fixture, [file])))
  return response.files.map(outcomeText)
})

const PROBED_SITES: ReadonlyArray<SiteSpec> = [
  { siteId: 'union', line: 1, text: `'a'`, candidates: [] },
  { siteId: 'number', line: 6, text: '1', candidates: [] },
  { siteId: 'boolean', line: 7, text: 'true', candidates: [] },
]

const PROBE_CANDIDATES = ['""', '0', 'true', 'null', '{}', '() => undefined']

const contextualTypesWithAndWithoutProbe = Effect.gen(function*() {
  const fixture = yield* fixtureOf('type-query')
  const bare = yield* readQueryFile(fixture, 'sites.ts', PROBED_SITES)
  const probed = yield* readQueryFile(
    fixture,
    'sites.ts',
    PROBED_SITES.map((site) => ({ ...site, candidates: PROBE_CANDIDATES })),
  )
  const [bareResponse, probedResponse] = yield* Effect.orDie(
    Effect.all([query(requestOf(fixture, [bare])), query(requestOf(fixture, [probed]))]),
  )
  return {
    bare: bareResponse.files.map(contextualTypesOf),
    probed: probedResponse.files.map(contextualTypesOf),
  }
})

const answeredTrailingComment = Effect.gen(function*() {
  const fixture = yield* fixtureOf('type-query')
  const file = yield* readQueryFile(fixture, 'comment.ts', [
    { siteId: 'number', line: 1, text: '1', candidates: ['""'] },
  ])
  const response = yield* Effect.orDie(query(requestOf(fixture, [file])))
  return response.files.map(outcomeText)
})

const PLAIN_BROKEN_ID = '00000000000000a1'
const PLAIN_PASSED_ID = '00000000000000a2'

const checkPlain = (fixture: Fixture, content: string) =>
  Effect.gen(function*() {
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: fixture.tsconfigFile })
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))([
      {
        id: PLAIN_BROKEN_ID,
        fileName: fixture.file('plain.ts'),
        mutatorName: 'StringLiteral',
        replacement: '""',
        location: locationOf(content, 1, `'a'`),
      },
      {
        id: PLAIN_PASSED_ID,
        fileName: fixture.file('plain.ts'),
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        location: locationOf(content, 2, 'true'),
      },
    ])
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* Effect.orDie(runtime.checker)
      const results = yield* checker.check([...wires])
      return Object.fromEntries(
        [PLAIN_BROKEN_ID, PLAIN_PASSED_ID].map((id) => [
          id,
          Option.match(HashMap.get(results, id), { onNone: () => 'missing', onSome: (result) => result.status }),
        ]),
      )
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
  }).pipe(Effect.orDie)

const panicBesideACheck: Effect.Effect<
  { readonly answers: ReadonlyArray<Readonly<Record<string, string>>>; readonly statuses: Record<string, string> },
  never,
  HostPorts
> = Effect.gen(function*() {
  const fixture = yield* fixtureOf('type-query-panic')
  const panic = yield* readQueryFile(fixture, 'panic.ts', [
    { siteId: 'empty-tuple', line: 2, text: '[]', candidates: ['""'] },
  ])
  const plain = yield* readQueryFile(fixture, 'plain.ts', [
    { siteId: 'union', line: 1, text: `'a'`, candidates: ['""'] },
  ])
  const [response, statuses] = yield* Effect.all([
    Effect.orDie(query(requestOf(fixture, [panic, plain]))),
    checkPlain(fixture, plain.content),
  ], { concurrency: 'unbounded' })
  return { answers: response.files.map(outcomeText), statuses }
})

const refusals = Effect.gen(function*() {
  const fixture = yield* fixtureOf('type-query')
  const file = yield* readQueryFile(fixture, 'sites.ts', SITES)
  const unsupported = yield* Effect.flip(query({ ...requestOf(fixture, [file]), version: 2 }))
  const outside = yield* Effect.orDie(
    query(requestOf(fixture, [{ ...file, fileName: fixture.file('../per-mutant-check/dep.ts') }])),
  )
  return {
    unsupported: unsupported.reason,
    outside: outside.files.flatMap((outcome) => Object.values(outcomeText(outcome))),
  }
})

Feature('Answering type queries on a tsgo server of their own', { timeout: 120_000 })
  .withLayer(FILE_PORTS)
  .live('real tsgo API servers and a real checker runtime over fixture projects on disk')
  .body(({ scenario }) => {
    scenario(
      'A literal that cannot sit where the site sits is NotAssignable, and nothing outside the grammar or under a generic call is',
      Gherkin.Do.pipe(
        When('a union-typed initializer, a tuple argument and a generic argument are queried')(
          'answers',
          () => answeredSites,
        ),
        Then('only the out-of-union literal is NotAssignable, with its literal type')((s, expect) =>
          expect(s.answers).toEqual([
            {
              'union ""': 'NotAssignable "" to "a" | "b"',
              'union "b"': 'Assignable "b"',
              'tuple []': 'Unknown candidate-not-context-free',
              'generic ""': 'Unknown overloaded-or-generic-call',
            },
          ])
        ),
      ),
    )

    scenario(
      'Appending probe statements leaves every site contextual type unchanged',
      Gherkin.Do.pipe(
        When('the same sites are queried with no candidates and with six context-free candidates')(
          'types',
          () => contextualTypesWithAndWithoutProbe,
        ),
        Then('both queries read the same contextual types')((s, expect) =>
          expect(s.types).toEqual({
            bare: [{ union: '"a" | "b"', number: 'number', boolean: 'boolean' }],
            probed: [{ union: '"a" | "b"', number: 'number', boolean: 'boolean' }],
          })
        ),
      ),
    )

    scenario(
      'A file ending in a line comment with no newline still has its candidates answered',
      Gherkin.Do.pipe(
        When('a site of that file is queried')('answers', () => answeredTrailingComment),
        Then('the probe statement lands after the comment and the candidate is answered')((s, expect) =>
          expect(s.answers).toEqual([{ 'number ""': 'NotAssignable "" to number' }])
        ),
      ),
    )

    scenario(
      'A file that crashes tsgo is refused, the next file is answered, and a concurrent check is untouched',
      Gherkin.Do.pipe(
        When('the empty-tuple panic file and an ordinary file are queried while the checker checks that file')(
          'seen',
          () => panicBesideACheck,
        ),
        Then('the panic file is refused server-crashed, the ordinary file is answered, and verdicts are usual')((
          s,
          expect,
        ) =>
          expect({ ...s.seen, answers: s.seen.answers.map((outcome) => Object.values(outcome)) }).toEqual({
            answers: [['FileRefused server-crashed'], ['NotAssignable "" to "a" | "b"']],
            statuses: { [PLAIN_BROKEN_ID]: 'compileError', [PLAIN_PASSED_ID]: 'passed' },
          })
        ),
      ),
    )

    scenario(
      'A request of another version is refused, and a file outside the project is refused on its own',
      Gherkin.Do.pipe(
        When('a version 2 request and a request for a file of another project are made')('seen', () => refusals),
        Then('the first is refused unsupported-version and the second file not-in-project')((s, expect) =>
          expect(s.seen).toEqual({ unsupported: 'unsupported-version', outside: ['FileRefused not-in-project'] })
        ),
      ),
    )
  })
