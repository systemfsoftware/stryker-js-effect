import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, GitDiff, GitDiffSchema } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const OTHER_SOURCE = [
  'export const other = (value: number): number => {',
  '  const tripled = value * 3',
  '  return tripled - 1',
  '}',
  '',
].join('\n')

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

interface Observation {
  readonly scope: string | undefined
  readonly mutatedFiles: readonly string[]
  readonly mutantLines: readonly number[]
  readonly failure: { readonly stage: string; readonly exitClass: string; readonly namesRef: boolean } | undefined
  readonly refsSeen: readonly string[]
}

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const mutatedFilesOf = (report: Report.MutationTestResult): readonly string[] =>
  Object.entries(report.files)
    .filter(([, file]) => file.mutants.length > 0)
    .map(([file]) => file.split('/').pop() ?? file)
    .sort()

const mutantLinesOf = (report: Report.MutationTestResult): readonly number[] =>
  Object.values(report.files)
    .flatMap((file) => file.mutants.map((mutant) => mutant.location.start.line))
    .sort((left, right) => left - right)

const runProject = (
  files: ReadonlyArray<readonly [string, string]>,
  since: string,
  gitOutcome: (ref: string) => Effect.Effect<GitDiffSchema.GitDiffResult, GitDiffSchema.GitDiffError>,
): Effect.Effect<Observation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* writeFixture(files)
    return yield* Effect.ensuring(
      Effect.gen(function*() {
        const refsSeen: string[] = []
        const fakeGit = Layer.succeed(GitDiff.GitDiff, {
          changedSince: (input: GitDiff.GitDiffInput) =>
            Effect.gen(function*() {
              refsSeen.push(input.ref)
              return yield* gitOutcome(input.ref)
            }),
        })
        const ports = Layer.mergeAll(Engine.nodePlatformLayer, fakeGit)
        const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
        const runLayer = Layer.merge(
          Layer.provide(Engine.stage(environmentFor(root), queue), ports),
          ports,
        )
        const options: Options.PartialStrykerOptions = {
          testRunner: 'command',
          commandRunner: { command: 'true' },
          coverageAnalysis: 'off',
          reporters: ['json'],
          jsonReporter: { fileName: path.join(root, 'reports', 'mutation.json') },
          mutate: ['src/**/*.ts'],
          checkers: [],
          cleanTempDir: 'always',
          since,
        }
        const exit = yield* Engine.mutationTestCell
          .run({ cliOptions: options, targetMutatePatterns: undefined })
          .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
        const events = [
          ...(yield* Queue.end(queue).pipe(
            Effect.andThen(Queue.takeAll(queue)),
            Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
          )),
        ]
        const reportText = yield* fs.readFileString(path.join(root, 'reports', 'mutation.json')).pipe(
          Effect.orElseSucceed(() => ''),
        )
        const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(reportText).pipe(
          Effect.orElseSucceed(() => undefined),
        )
        const verdict = events.find(S.is(RunEvent.VerdictReached))
        const failure = Exit.match(exit, {
          onFailure: (cause) =>
            Option.match(Cause.findErrorOption(cause), {
              onNone: () => undefined,
              onSome: (stageError) => ({
                stage: stageError.stage,
                exitClass: stageError.exitClass,
                namesRef: S.is(GitDiffSchema.GitRefUnresolved)(stageError.cause),
              }),
            }),
          onSuccess: () => undefined,
        })
        return {
          scope: verdict?.scope,
          mutatedFiles: report === undefined ? [] : mutatedFilesOf(report),
          mutantLines: report === undefined ? [] : mutantLinesOf(report),
          failure,
          refsSeen,
        }
      }),
      Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    )
  }).pipe(Effect.provide(filePorts))

const diffHunk = (file: string): GitDiffSchema.GitDiffResult => ({
  ref: 'HEAD~1',
  base: 'base-sha',
  hunks: [{ file, startLine: 3, lineCount: 1 }],
  untrackedFiles: [],
})

Feature('Scoping a mutation run to the changed lines since a git ref')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine with a fake git service, so no git process is spawned')
  .body(({ scenario }) => {
    scenario(
      'A diff-scoped run mutates only the changed line of the changed file',
      Gherkin.Do.pipe(
        Given('a project whose git diff changes line 3 of the target file only')(
          'observation',
          () =>
            runProject(
              [['src/target.ts', TARGET_SOURCE], ['src/other.ts', OTHER_SOURCE]],
              'HEAD~1',
              () => Effect.succeed(diffHunk('src/target.ts')),
            ),
        ),
        Then('the verdict records the diff scope and only the target line carries mutants')((s, expect) =>
          expect({
            scope: s.observation.scope,
            mutatedFiles: s.observation.mutatedFiles,
            mutantLines: s.observation.mutantLines,
          }).toEqual({ scope: 'diff', mutatedFiles: ['target.ts'], mutantLines: [3] })
        ),
      ),
    )

    scenario(
      'A changed Stryker configuration widens the run to the full scope',
      Gherkin.Do.pipe(
        Given('a project whose git diff changes the Stryker configuration')(
          'observation',
          () =>
            runProject(
              [['src/target.ts', TARGET_SOURCE], ['src/other.ts', OTHER_SOURCE], [
                'stryker.config.mjs',
                'export default {}\n',
              ]],
              'HEAD~1',
              () => Effect.succeed(diffHunk('stryker.config.mjs')),
            ),
        ),
        Then('the verdict records the full scope and both files carry mutants')((s, expect) =>
          expect({
            scope: s.observation.scope,
            mutatedFiles: s.observation.mutatedFiles,
          }).toEqual({ scope: 'full', mutatedFiles: ['other.ts', 'target.ts'] })
        ),
      ),
    )

    scenario(
      'An unknown ref fails the run with a named preparation error and exit class 2',
      Gherkin.Do.pipe(
        Given('a project whose git ref cannot be resolved')(
          'observation',
          () =>
            runProject(
              [['src/target.ts', TARGET_SOURCE]],
              'not-a-ref',
              (ref) => Effect.fail(GitDiffSchema.GitRefUnresolved.make({ ref, detail: 'unknown revision' })),
            ),
        ),
        Then('the run fails while preparing, naming the ref, with the configuration exit class')((s, expect) =>
          expect(s.observation.failure).toEqual({ stage: 'prepare', exitClass: 'ConfigError', namesRef: true })
        ),
      ),
    )

    scenario(
      'A ref with shell metacharacters reaches the git service as one literal argument',
      Gherkin.Do.pipe(
        Given('a project run with a ref that would be dangerous through a shell')(
          'observation',
          () =>
            runProject(
              [['src/target.ts', TARGET_SOURCE]],
              '"; touch pwned #',
              () => Effect.succeed(diffHunk('src/target.ts')),
            ),
        ),
        Then('the git service receives that ref verbatim, never interpreted as a command')((s, expect) =>
          expect(s.observation.refsSeen).toEqual(['"; touch pwned #'])
        ),
      ),
    )
  })
