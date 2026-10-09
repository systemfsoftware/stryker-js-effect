import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { VerdictStoreUnavailable } from '@systemfsoftware/stryker-js/verdict-store'
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

const S3_PACKAGE = '@systemfsoftware/stryker-js-verdict-store-s3'

const SOURCE_FILE = 'src/math.ts'

const TEST_FILE = 'test/math.test.mjs'

const writeProject = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'package.json'), '{ "name": "store-selection", "type": "module" }\n')
    yield* fs.writeFileString(
      path.join(root, SOURCE_FILE),
      'export const add = (left: number, right: number): number => left + right\n',
    )
    yield* fs.writeFileString(path.join(root, TEST_FILE), "import { test } from 'vitest'\ntest('runs', () => {})\n")
    return root
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true })))

const runFromProject = (
  root: string,
  verdictStore: Options.VerdictStoreOptions,
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
    () =>
      Effect.result(
        Engine.strykerCell({
          testRunner: 'vm',
          checkers: [],
          reporters: [],
          mutate: [SOURCE_FILE],
          testFiles: [TEST_FILE],
          verdictStore,
        }),
      ),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const refusalOf = (outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>) =>
  Result.match(outcome, {
    onFailure: (failure) =>
      Match.value(failure).pipe(
        Match.tag('StageError', (refused) => ({
          stage: refused.stage,
          refusal: Option.getOrNull(S.decodeUnknownOption(VerdictStoreUnavailable)(refused.cause)),
        })),
        Match.tag('PlatformError', () => ({ stage: null, refusal: null })),
        Match.exhaustive,
      ),
    onSuccess: () => ({ stage: null, refusal: null }),
  })

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Choosing where mutation verdicts are stored')
  .withLayer(runLayer)
  .live('the scenarios write and remove a real project directory, so the run waits on real filesystem I/O')
  .body(({ scenario }) => {
    scenario(
      'Choosing the S3 store without installing its package stops the run while preparing',
      Gherkin.Do.pipe(
        Given('a project that does not install the S3 verdict store package')('root', () => writeProject()),
        When('a run starts with verdicts stored in an S3 bucket')(
          'outcome',
          (s) =>
            runFromProject(s.root, { kind: 's3', bucket: 'verdicts', prefix: 'main' }).pipe(
              Effect.ensuring(removeProject(s.root)),
            ),
        ),
        Then('the run stops before instrumenting, naming the bucket and the package to install')((s, expect) => {
          const { stage, refusal } = refusalOf(s.outcome)
          return expect({
            stage,
            store: refusal?.store,
            namesThePackage: refusal?.reason.includes(`npm install --save-dev ${S3_PACKAGE}`),
          }).toEqual({ stage: 'prepare', store: 's3://verdicts/main', namesThePackage: true })
        }),
      ),
    )

    scenario(
      'A filesystem store whose root is a regular file stops the run while preparing',
      Gherkin.Do.pipe(
        Given('a project where a regular file occupies the store directory')(
          'root',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeProject()
              yield* fs.writeFileString(path.join(root, 'verdicts'), 'not a directory\n')
              return root
            }),
        ),
        When('a run starts with verdicts stored under that path')(
          'outcome',
          (s) =>
            runFromProject(s.root, { kind: 'fs', directory: 'verdicts' }).pipe(Effect.ensuring(removeProject(s.root))),
        ),
        Then('the run stops before instrumenting, naming the store root')((s, expect) => {
          const { stage, refusal } = refusalOf(s.outcome)
          return expect({ stage, store: refusal?.store, reason: refusal?.reason }).toEqual({
            stage: 'prepare',
            store: `${s.root}/verdicts`,
            reason: 'the store root is a File, not a directory',
          })
        }),
      ),
    )
  })
