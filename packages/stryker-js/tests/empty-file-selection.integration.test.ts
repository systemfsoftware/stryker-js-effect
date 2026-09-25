import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { type Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { PrepareError } from '@systemfsoftware/stryker-js/events'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const SOURCE_FILE = 'src/math.ts'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'

const TEST_FILE = 'test/math.test.mjs'
const TEST_CONTENT = [
  "import { expect, test } from 'vitest'",
  '',
  "test('adds one and one', () => {",
  '  expect(1 + 1).toBe(2)',
  '})',
].join('\n')

const REPORT_FILE = 'reports/mutation/mutation.json'

const writeProject = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(path.join(root, SOURCE_FILE), SOURCE_CONTENT)
    yield* fs.writeFileString(path.join(root, TEST_FILE), TEST_CONTENT)
    return root
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(root, { recursive: true })),
  ))

const runFromProject = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<
  Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>,
  never,
  Engine.EnginePorts
> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () => Effect.result(Engine.strykerCell(options)),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const reportedFilesOf = (
  root: string,
): Effect.Effect<Report.MutationTestResult['files'], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, REPORT_FILE))
    const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResultSchema))(text)
    return report.files
  }).pipe(Effect.orDie)

const verdictOf = (outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>) =>
  Result.match(outcome, {
    onFailure: (failure) => `refused: ${failure.message}`,
    onSuccess: (done) => done.verdict,
  })

const refusalOf = (outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>) =>
  Result.match(outcome, {
    onFailure: (failure) =>
      Match.value(failure).pipe(
        Match.tag('StageError', (refused) => ({
          stage: refused.stage,
          causeMessage: Option.getOrNull(
            Option.map(S.decodeUnknownOption(PrepareError)(refused.cause), (cause) => cause.message),
          ),
        })),
        Match.tag('PlatformError', (platform) => ({ stage: null, causeMessage: platform.message })),
        Match.exhaustive,
      ),
    onSuccess: () => ({ stage: null, causeMessage: null }),
  })

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Running mutation testing when no file is selected')
  .withLayer(runLayer)
  .live('the scenario writes and removes a real project directory, so the run waits on real filesystem I/O')
  .body(({ scenario }) => {
    scenario(
      'A project without any file is refused, and the refusal says why',
      Gherkin.Do.pipe(
        Given('a project directory with nothing in it')(
          'root',
          () => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectory()),
        ),
        When('a run starts')(
          'outcome',
          (s) =>
            runFromProject(s.root, { testRunner: 'vm', checkers: [] }).pipe(Effect.ensuring(removeProject(s.root))),
        ),
        Then('the run stops while preparing, naming the missing input files')((s, expect) =>
          expect(refusalOf(s.outcome)).toEqual({ stage: 'prepare', causeMessage: 'No input files found.' })
        ),
      ),
    )

    scenario(
      'A shard left with no file to mutate still passes and writes an empty report',
      Gherkin.Do.pipe(
        Given('a project with one source file and one passing test')('root', () => writeProject()),
        When('a run starts that both includes and excludes that file, demanding a perfect score')(
          'observed',
          (s) =>
            Effect.gen(function*() {
              const outcome = yield* runFromProject(s.root, {
                testRunner: 'vm',
                testFiles: ['test/**/*.mjs'],
                mutate: [SOURCE_FILE, `!${SOURCE_FILE}`],
                checkers: [],
                reporters: ['json'],
                jsonReporter: { fileName: REPORT_FILE },
                thresholds: { high: 80, low: 60, break: 100 },
              })
              const files = yield* reportedFilesOf(s.root)
              return { verdict: verdictOf(outcome), files }
            }).pipe(Effect.ensuring(removeProject(s.root))),
        ),
        Then('the run passes and its report lists no file')((s, expect) =>
          expect(s.observed).toEqual({ verdict: null, files: {} })
        ),
      ),
    )
  })
