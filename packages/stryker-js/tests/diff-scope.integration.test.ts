import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import { type CliOutcome, runCli } from './__fixtures__/cli-project.fixture.js'
import { committerArgs, CONTRACT_GIT_IDENTITY, execGit, gitOutput, writeFile } from './__fixtures__/git-repo.fixture.js'

const Feature = makeFeature({ it })

const COMMITTER = committerArgs(CONTRACT_GIT_IDENTITY)

const TARGET_FILE = 'src/target.ts'
const OTHER_FILE = 'src/other.ts'
const CONFIG_FILE = 'stryker.config.mjs'
const MANIFEST_FILE = 'package.json'
const IGNORE_FILE = '.gitignore'
const REPORT_FILE = 'reports/mutation.json'
const UNKNOWN_REF = 'no-such-ref'
const METACHARACTER_REF = '"; touch pwned #'
const PWNED_FILE = 'pwned'

const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const CHANGED_TARGET_SOURCE = TARGET_SOURCE.replace('return doubled + 1', 'return doubled + 2')

const OTHER_SOURCE = [
  'export const other = (value: number): number => {',
  '  const tripled = value * 3',
  '  return tripled - 1',
  '}',
  '',
].join('\n')

const MANIFEST_SOURCE = '{ "name": "diff-scope-consumer", "type": "module", "private": true }\n'

const CONFIG_SOURCE = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'off',
  checkers: [],
  reporters: ['json'],
  jsonReporter: { fileName: '${REPORT_FILE}' },
  thresholds: { high: 100, low: 80, break: 0 },
  cleanTempDir: 'always',
}
`

const CHANGED_CONFIG_SOURCE = `${CONFIG_SOURCE}\n// the developer edits the Stryker configuration\n`

const BASE_FILES: ReadonlyArray<readonly [string, string]> = [
  [MANIFEST_FILE, MANIFEST_SOURCE],
  [IGNORE_FILE, 'reports/\n'],
  [CONFIG_FILE, CONFIG_SOURCE],
  [TARGET_FILE, TARGET_SOURCE],
  [OTHER_FILE, OTHER_SOURCE],
]

interface Repo {
  readonly root: string
  readonly base: string
}

const writeRepoFile = (
  root: string,
  file: string,
  content: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> => writeFile(root, file, content)

const commitAll = (
  root: string,
  message: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', message])
  })

const prepareRepo = (): Effect.Effect<
  Repo,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-diff-scope-' }))
    yield* Effect.forEach(BASE_FILES, ([file, content]) => writeRepoFile(root, file, content), { discard: true })
    yield* execGit(root, ['init', '-q'])
    yield* commitAll(root, 'base')
    const base = yield* gitOutput(root, ['rev-parse', 'HEAD'])
    return { root, base }
  }).pipe(Effect.orDie)

const runSince = (
  root: string,
  ref: string,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  runCli({ root, args: ['run', '--since', ref], mode })

const planSince = (
  root: string,
  ref: string,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  runCli({ root, args: ['plan', '--target-seconds', '1', '--out', 'plan.json', '--since', ref], mode })

const fileExists = (
  root: string,
  file: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* fs.exists(path.join(root, file))
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

const verdictOf = (stdout: string): Option.Option<RunEvent.VerdictReached> =>
  Option.firstSomeOf(
    stdout.split('\n').map((line) =>
      line.trimStart().startsWith('{')
        ? S.decodeOption(S.fromJsonString(RunEvent.VerdictReached))(line.trim())
        : Option.none()
    ),
  )

interface RunObservation {
  readonly exitCode: number
  readonly scope: string | undefined
  readonly mutatedFiles: readonly string[]
  readonly mutantLines: readonly number[]
}

const observeRun = (
  root: string,
  ran: CliOutcome,
): Effect.Effect<RunObservation, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reportText = yield* fs.readFileString(path.join(root, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    const report = Option.getOrUndefined(S.decodeOption(S.fromJsonString(Report.MutationTestResult))(reportText))
    return {
      exitCode: ran.exitCode,
      scope: Option.match(verdictOf(ran.stdout), { onNone: () => undefined, onSome: (verdict) => verdict.scope }),
      mutatedFiles: report === undefined ? [] : mutatedFilesOf(report),
      mutantLines: report === undefined ? [] : mutantLinesOf(report),
    }
  }).pipe(Effect.orDie)

Feature('Scoping a mutation run to the changed lines since a git ref', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary diffs a real temporary git repository and mutates only the changed lines')
  .body(({ scenario }) => {
    scenario(
      'A diff-scoped run mutates only the changed line of the changed file',
      Gherkin.Do.pipe(
        Given('a repository whose target line changed since its base commit')(
          'repo',
          () =>
            Effect.gen(function*() {
              const repo = yield* prepareRepo()
              yield* writeRepoFile(repo.root, TARGET_FILE, CHANGED_TARGET_SOURCE)
              yield* commitAll(repo.root, 'change the target line')
              return repo
            }),
        ),
        When('the run is scoped to the base commit')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const ran = yield* runSince(s.repo.root, s.repo.base, 'machine')
              return yield* observeRun(s.repo.root, ran)
            }),
        ),
        Then('the verdict records the diff scope and only the target line carries mutants')((s, expect) =>
          expect({
            exitCode: s.observation.exitCode,
            scope: s.observation.scope,
            mutatedFiles: s.observation.mutatedFiles,
            mutantLines: s.observation.mutantLines,
          }).toEqual({ exitCode: 0, scope: 'diff', mutatedFiles: ['target.ts'], mutantLines: [3] })
        ),
      ),
    )

    scenario(
      'A changed Stryker configuration widens the run to the full scope',
      Gherkin.Do.pipe(
        Given('a repository whose Stryker configuration changed since its base commit')(
          'repo',
          () =>
            Effect.gen(function*() {
              const repo = yield* prepareRepo()
              yield* writeRepoFile(repo.root, CONFIG_FILE, CHANGED_CONFIG_SOURCE)
              yield* commitAll(repo.root, 'change the Stryker configuration')
              return repo
            }),
        ),
        When('the run is scoped to the base commit')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const ran = yield* runSince(s.repo.root, s.repo.base, 'machine')
              return yield* observeRun(s.repo.root, ran)
            }),
        ),
        Then('the verdict records the full scope and both files carry mutants')((s, expect) =>
          expect({
            exitCode: s.observation.exitCode,
            scope: s.observation.scope,
            mutatedFiles: s.observation.mutatedFiles,
          }).toEqual({ exitCode: 0, scope: 'full', mutatedFiles: ['other.ts', 'target.ts'] })
        ),
      ),
    )

    scenario(
      'An unknown ref fails the plan with a named configuration error and exit class 2',
      Gherkin.Do.pipe(
        Given('a repository holding a committed stryker project')('repo', () => prepareRepo()),
        When('the plan is scoped to a ref the repository does not have')(
          'ran',
          (s) => planSince(s.repo.root, UNKNOWN_REF, 'human'),
        ),
        Then('the plan exits with the configuration class, naming the ref')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesRef: s.ran.stderr.includes(UNKNOWN_REF),
            namesClass: s.ran.stderr.includes('exit 2 (ConfigError)'),
          }).toEqual({ exitCode: 2, namesRef: true, namesClass: true })
        ),
      ),
    )

    scenario(
      'A plan scoped to a ref with shell metacharacters reaches git as one literal argument',
      Gherkin.Do.pipe(
        Given('a repository holding a committed stryker project')('repo', () => prepareRepo()),
        When('the plan is scoped to a ref that would be dangerous through a shell')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const ran = yield* planSince(s.repo.root, METACHARACTER_REF, 'human')
              return { ran, pwned: yield* fileExists(s.repo.root, PWNED_FILE) }
            }),
        ),
        Then('git refuses the ref verbatim and no shell command ran')((s, expect) =>
          expect({
            exitCode: s.observation.ran.exitCode,
            namesTheLiteralRef: s.observation.ran.stderr.includes(METACHARACTER_REF),
            pwned: s.observation.pwned,
          }).toEqual({ exitCode: 2, namesTheLiteralRef: true, pwned: false })
        ),
      ),
    )
  })
