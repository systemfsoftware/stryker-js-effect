import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Options, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime, TypeScriptCheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import {
  Recorded,
  RecordedCheck,
  RecordedJson,
  RecordedMutant,
  RecordedTypeAnswer,
} from './__fixtures__/real-code-corpus.fixture.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

const FROZEN_SOURCE_FILES = [
  'Location.schema.ts',
  'TypeQuery.schema.ts',
  'gate-score-break.workflow.ts',
  'mutant-set-policy.workflow.ts',
  'resolve-concurrency.workflow.ts',
]

const EXPECTED_FILE = 'expected-verdicts.json'

const UPDATE_ENV = 'STRYKER_CORPUS_UPDATE'

const TYPE_QUERY_VERSION = 2

type ImporterCheck = 'always' | 'location-rule'

type Ports = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

type Wire = Checker.CheckerMutantWire

type FileRefused = TypeQuery.FileRefused

interface TypeAnswerOf {
  readonly wire: Wire
  readonly answer: TypeQuery.TypeAnswer
}

interface TypeAnswers {
  readonly answers: ReadonlyArray<TypeAnswerOf>
  readonly refusedFiles: ReadonlyArray<FileRefused>
}

interface NotAssignableButCompiles {
  readonly mutant: RecordedMutant
  readonly answer: TypeQuery.TypeAnswer
  readonly fullStatus: Checker.CheckStatus
}

interface Observation {
  readonly full: typeof Recorded.Encoded
  readonly shortcutChecks: ReadonlyArray<RecordedCheck>
  readonly fullChecks: ReadonlyArray<RecordedCheck>
  readonly notAssignableButCompiles: ReadonlyArray<NotAssignableButCompiles>
  readonly refusedFiles: ReadonlyArray<FileRefused>
  readonly expected: Option.Option<typeof Recorded.Encoded>
}

const instrumenterOptions: Instrument.InstrumenterOptions = {
  excludedMutations: [],
  ignorers: [],
  mutantSetPolicy: 'default',
  mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
}

const corpusDirectory = Effect.gen(function*() {
  const pathService = yield* Path.Path
  const here = yield* pathService.fromFileUrl(new URL(import.meta.url)).pipe(Effect.orDie)
  return pathService.join(pathService.dirname(here), '__fixtures__', 'real-code-corpus')
})

const wiresOf = (directory: string): Effect.Effect<ReadonlyArray<Wire>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const sources = yield* Effect.forEach(
      FROZEN_SOURCE_FILES,
      (file) =>
        Effect.map(fs.readFileString(pathService.join(directory, file)), (content) => ({
          name: pathService.join(directory, file),
          content,
          mutate: true,
        })),
    ).pipe(Effect.orDie)
    const instrumented = yield* Effect.orDie(Instrument.instrument(sources, instrumenterOptions))
    return instrumented.mutants.map((mutant): Wire => ({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    }))
  })

const statusesWith = (
  directory: string,
  wires: ReadonlyArray<Wire>,
  importerCheck: ImporterCheck,
): Effect.Effect<HashMap.HashMap<string, Checker.CheckStatus>, never, Ports> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: pathService.join(directory, 'tsconfig.json'),
      typescriptChecker: { importerCheck },
    })
    const results = yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* Effect.orDie(runtime.checker)
      return yield* checker.check([...wires])
    }).pipe(Effect.provide(TypeScriptCheckerRuntime.layer(options)))
    return HashMap.map(results, (result): Checker.CheckStatus => result.status)
  }).pipe(Effect.orDie)

const mutantOf = (pathService: Path.Path, wire: Wire): RecordedMutant =>
  RecordedMutant.make({
    file: pathService.basename(wire.fileName),
    line: wire.location.start.line,
    column: wire.location.start.column,
    mutator: wire.mutatorName,
    replacement: wire.replacement,
  })

const statusOf = (
  pathService: Path.Path,
  statuses: HashMap.HashMap<string, Checker.CheckStatus>,
  wire: Wire,
): Effect.Effect<Checker.CheckStatus> =>
  Option.match(HashMap.get(statuses, wire.id), {
    onNone: () => Effect.die(`the checker returned no result for ${JSON.stringify(mutantOf(pathService, wire))}`),
    onSome: Effect.succeed,
  })

const checksOf = (
  pathService: Path.Path,
  statuses: HashMap.HashMap<string, Checker.CheckStatus>,
  wires: ReadonlyArray<Wire>,
): Effect.Effect<ReadonlyArray<RecordedCheck>> =>
  Effect.forEach(
    wires,
    (wire) =>
      Effect.map(statusOf(pathService, statuses, wire), (status) =>
        RecordedCheck.make({ mutant: mutantOf(pathService, wire), status })),
  )

const siteIdOf = (wire: Wire): string =>
  `${wire.location.start.line}:${wire.location.start.column}:${wire.location.end.line}:${wire.location.end.column}`

const siteKindOf = (atSite: ReadonlyArray<Wire>): TypeQuery.TypeQuerySiteKind =>
  atSite.every((wire) => wire.mutatorName === 'BlockStatement' && wire.replacement === '{}')
    ? 'function-body'
    : 'expression'

const answersOf = (wires: ReadonlyArray<Wire>, outcome: TypeQuery.FileOutcome): ReadonlyArray<TypeAnswerOf> =>
  Match.valueTags(outcome, {
    FileRefused: () => [],
    FileAnswered: (answered) =>
      answered.sites.flatMap((site) =>
        Arr.getSomes(site.candidates.map((candidate) =>
          Option.map(
            Option.fromUndefinedOr(wires.find((wire) => wire.id === candidate.candidateId)),
            (wire) => ({ wire, answer: candidate.answer }),
          )
        ))
      ),
  })

const refusedOf = (outcome: TypeQuery.FileOutcome): ReadonlyArray<FileRefused> =>
  Match.valueTags(outcome, {
    FileRefused: (refused) => [refused],
    FileAnswered: () => [],
  })

const typeAnswersOf = (
  directory: string,
  wires: ReadonlyArray<Wire>,
): Effect.Effect<TypeAnswers, never, Ports> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const files = yield* Effect.forEach(
      Object.entries(Arr.groupBy(wires, (wire) => wire.fileName)),
      ([fileName, fileWires]) =>
        Effect.map(fs.readFileString(fileName), (content) =>
          TypeQuery.TypeQueryFile.make({
            fileName,
            content,
            sites: Object.entries(Arr.groupBy(fileWires, siteIdOf)).map(([siteId, atSite]) =>
              TypeQuery.TypeQuerySite.make({
                siteId,
                kind: siteKindOf(atSite),
                location: atSite[0].location,
                candidates: atSite.map((wire) => ({ candidateId: wire.id, text: wire.replacement })),
              })
            ),
          })),
    ).pipe(Effect.orDie)
    const nonEmptyFiles = yield* Arr.match(files, {
      onEmpty: () => Effect.die('the corpus instrumented to no mutants'),
      onNonEmpty: Effect.succeed,
    })
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: pathService.join(directory, 'tsconfig.json'),
    }).pipe(Effect.orDie)
    const response = yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const typeQuery = yield* runtime.typeQuery
      return yield* typeQuery.query(
        TypeQuery.TypeQueryRequest.make({
          version: TYPE_QUERY_VERSION,
          tsconfigFile: pathService.join(directory, 'tsconfig.json'),
          files: nonEmptyFiles,
        }),
      )
    }).pipe(Effect.provide(TypeScriptCheckerRuntime.layer(options)), Effect.orDie)
    return {
      answers: response.files.flatMap((outcome) => answersOf(wires, outcome)),
      refusedFiles: response.files.flatMap(refusedOf),
    }
  })

const entryLines = <A>(entries: ReadonlyArray<A>): string =>
  entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n')

const snapshotText = (encoded: typeof Recorded.Encoded): string =>
  `{\n  "checks": [\n${entryLines(encoded.checks)}\n  ],\n  "typeAnswers": [\n${
    entryLines(encoded.typeAnswers)
  }\n  ]\n}\n`

const notAssignableButCompilesOf = (
  pathService: Path.Path,
  full: HashMap.HashMap<string, Checker.CheckStatus>,
  answers: ReadonlyArray<TypeAnswerOf>,
): Effect.Effect<ReadonlyArray<NotAssignableButCompiles>> =>
  Effect.map(
    Effect.forEach(
      answers.filter(({ answer }) =>
        Match.valueTags(answer, { NotAssignable: () => true, Assignable: () => false, Unknown: () => false })
      ),
      ({ wire, answer }) =>
        Effect.map(statusOf(pathService, full, wire), (fullStatus) => ({
          mutant: mutantOf(pathService, wire),
          answer,
          fullStatus,
        })),
    ),
    (entries) => entries.filter((entry) => entry.fullStatus !== 'compileError'),
  )

const observe: Effect.Effect<Observation, never, Ports> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const directory = yield* corpusDirectory
  const wires = yield* wiresOf(directory)
  const full = yield* statusesWith(directory, wires, 'always')
  const shortcut = yield* statusesWith(directory, wires, 'location-rule')
  const { answers, refusedFiles } = yield* typeAnswersOf(directory, wires)
  const fullChecks = yield* checksOf(pathService, full, wires)
  const typeAnswers = answers.map(({ wire, answer }) =>
    RecordedTypeAnswer.make({ mutant: mutantOf(pathService, wire), answer })
  )
  const encoded = yield* Effect.orDie(S.encodeEffect(Recorded)(Recorded.make({ checks: fullChecks, typeAnswers })))
  const expectedPath = pathService.join(directory, EXPECTED_FILE)
  const update = yield* Config.Boolean(UPDATE_ENV).pipe(Config.withDefault(false), Effect.orDie)
  yield* Boolean.match(update, {
    onTrue: () => Effect.orDie(fs.writeFileString(expectedPath, snapshotText(encoded))),
    onFalse: () => Effect.void,
  })
  const expectedText = yield* Effect.option(fs.readFileString(expectedPath))
  const expected = yield* Option.match(expectedText, {
    onNone: () => Effect.succeed(Option.none<typeof Recorded.Encoded>()),
    onSome: (text) =>
      S.decodeEffect(RecordedJson)(text).pipe(
        Effect.flatMap(S.encodeEffect(Recorded)),
        Effect.asSome,
        Effect.orDie,
      ),
  })
  return {
    full: encoded,
    fullChecks,
    shortcutChecks: yield* checksOf(pathService, shortcut, wires),
    notAssignableButCompiles: yield* notAssignableButCompilesOf(pathService, full, answers),
    refusedFiles,
    expected,
  }
})

Feature('Checking real code against recorded verdicts', { timeout: 600_000 })
  .withLayer(FILE_PORTS)
  .live('the stock mutators over frozen source files of this repository, checked in process')
  .body(({ scenario }) => {
    scenario(
      'Every mutant of the corpus keeps its recorded verdict and type answer, and both shortcuts agree with the full check',
      Gherkin.Do.pipe(
        When('the corpus is instrumented, checked with and without the importer shortcut, and type-queried')(
          'seen',
          () => observe,
        ),
        Then(
          `the shortcuts agree with the full check and every answer matches ${EXPECTED_FILE}; after a deliberate checker change rewrite it with ${UPDATE_ENV}=1`,
        )(
          (s, expect) =>
            expect({
              importerShortcut: s.seen.shortcutChecks,
              notAssignableButCompiles: s.seen.notAssignableButCompiles,
              refusedFiles: s.seen.refusedFiles,
              recorded: Option.getOrNull(s.seen.expected),
            }).toEqual({
              importerShortcut: s.seen.fullChecks,
              notAssignableButCompiles: [],
              refusedFiles: [],
              recorded: s.seen.full,
            }),
        ),
      ),
    )
  })
