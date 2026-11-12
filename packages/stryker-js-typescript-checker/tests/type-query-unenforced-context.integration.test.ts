import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, Worker } from '@systemfsoftware/stryker-js'
import { Checker, Options, Plugin, type TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'

const Feature = makeFeature({ it })

const FIXTURE_URL = new URL('./__fixtures__/worker-type-query-spread/', import.meta.url)
const WORKER_ENTRYPOINT = new URL('../dist/main.mjs', import.meta.url).href
const WORKING_DIRECTORY_URL = new URL('../', import.meta.url)

const MUTANT_ID = '00000000000000c1'
const SPREAD_OBJECT = '{ noHeader: options.noHeader }'
const EMPTY_OBJECT = '{}'

interface Project {
  readonly tsconfigFile: string
  readonly sourceFile: string
  readonly source: string
}

const project: Effect.Effect<Project, never, FileSystem.FileSystem | Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const directory = yield* path.fromFileUrl(FIXTURE_URL)
  const sourceFile = path.join(directory, 'format.ts')
  return {
    tsconfigFile: path.join(directory, 'tsconfig.json'),
    sourceFile,
    source: yield* fs.readFileString(sourceFile),
  }
}).pipe(Effect.orDie)

const locationOf = (content: string, text: string): TypeQuery.TypeQuerySite['location'] => {
  const lines = content.split('\n')
  const index = lines.findIndex((line) => line.includes(text))
  const column = (lines[index] ?? '').indexOf(text) + 1
  return { start: { line: index + 1, column }, end: { line: index + 1, column: column + text.length } }
}

const publishedEngineOptionsOf = (options: Options.StrykerOptions) => ({ ...options, incrementalSources: [] })

const makeClient = (tsconfigFile: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const options = Result.getOrThrow(
      S.decodeResult(Options.StrykerOptionsSchema)({ tsconfigFile, typescriptChecker: {} }),
    )
    return yield* Worker.makeWorkerClient({
      rpcs: Plugin.CheckerRpcs,
      options: publishedEngineOptionsOf(options),
      entrypoint: WORKER_ENTRYPOINT,
      workingDirectory: yield* path.fromFileUrl(WORKING_DIRECTORY_URL),
      execArgv: [],
      tempDirPrefix: 'stryker-checker-unenforced-context-',
    })
  }).pipe(Effect.orDie)

const requestOf = (fixture: Project): TypeQuery.TypeQueryRequest => ({
  version: 1,
  tsconfigFile: fixture.tsconfigFile,
  files: [{
    fileName: fixture.sourceFile,
    content: fixture.source,
    sites: [{
      siteId: 'spread-object',
      kind: 'expression',
      location: locationOf(fixture.source, SPREAD_OBJECT),
      candidates: [{ candidateId: 'empty-object', text: EMPTY_OBJECT }],
    }],
  }],
})

const answerText = (answer: TypeQuery.TypeAnswer): string =>
  Match.valueTags(answer, {
    Assignable: (assignable) => `Assignable ${assignable.candidateType}`,
    NotAssignable: (notAssignable) => `NotAssignable ${notAssignable.candidateType} to ${notAssignable.contextualType}`,
    Unknown: (unknown) => `Unknown ${unknown.reason}`,
  })

const answersOf = (response: TypeQuery.TypeQueryResponse): ReadonlyArray<string> =>
  response.files.flatMap((outcome): ReadonlyArray<string> =>
    Match.valueTags(outcome, {
      FileAnswered: (answered) =>
        answered.sites.flatMap((site) => site.candidates.map((candidate) => answerText(candidate.answer))),
      FileRefused: (refused) => [`FileRefused ${refused.reason}`],
    })
  )

const queryThenCheck: Effect.Effect<
  { readonly answers: ReadonlyArray<string>; readonly verdict: string | undefined },
  never,
  FileSystem.FileSystem | Path.Path | Worker.WorkerLauncher | Scope.Scope
> = Effect.gen(function*() {
  const fixture = yield* project
  const client = yield* makeClient(fixture.tsconfigFile)
  const response = yield* client.typeQuery(requestOf(fixture)).pipe(Effect.orDie)
  const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))([{
    id: MUTANT_ID,
    fileName: fixture.sourceFile,
    mutatorName: 'ObjectLiteral',
    replacement: EMPTY_OBJECT,
    location: locationOf(fixture.source, SPREAD_OBJECT),
  }]).pipe(Effect.orDie)
  const verdicts = yield* client.check({ checkerName: 'typescript', mutants: [...wires] }).pipe(Effect.orDie)
  return { answers: answersOf(response), verdict: verdicts[MUTANT_ID]?.status }
}).pipe(Effect.orDie)

Feature('A type query never calls a mutant a compile error that the checker passes', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built checker worker and real tsgo on a project shaped like the instrumenter’s options mapping')
  .body(({ scenario }) => {
    scenario(
      'An object written inside a conditional spread is not judged against the whole returned object',
      Gherkin.Do.pipe(
        When('the worker is asked about emptying the spread object, and then checks that same change')(
          'seen',
          () => queryThenCheck,
        ),
        Then('the worker does not claim the change breaks the build, and the check passes it')((s, expect) =>
          expect(s.seen).toEqual({ answers: ['Unknown context-not-enforced'], verdict: 'passed' })
        ),
      ),
    )
  })
