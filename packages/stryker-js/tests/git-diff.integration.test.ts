import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Cli, GitDiff, GitDiffSchema } from '@systemfsoftware/stryker-js'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const COMMITTER = ['-c', 'user.email=contract@test', '-c', 'user.name=contract'] as const

const execGit = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* ChildProcess.make('git', args, {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
    const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString)
    const exitCode = Number(yield* handle.exitCode)
    yield* Effect.when(
      Effect.die(new Error(`git ${args.join(' ')} failed (${exitCode}): ${stderr}`)),
      Effect.succeed(exitCode !== 0),
    )
  }).pipe(Effect.orDie)

const writeFile = (
  root: string,
  file: string,
  content: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, file)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, content)
  }).pipe(Effect.orDie)

const buildRepo = (): Effect.Effect<
  string,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    yield* execGit(root, ['init', '-q'])
    yield* writeFile(root, 'src/kept.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
    yield* writeFile(root, 'src/gone.ts', 'const removed = 1\n')
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', 'init'])
    yield* writeFile(root, 'src/kept.ts', 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5\n')
    yield* writeFile(root, 'src/new.ts', 'const fresh = 1\n')
    yield* execGit(root, [...COMMITTER, 'rm', '-q', 'src/gone.ts'])
    return root
  }).pipe(Effect.orDie)

const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Option.Option<E>, never, R> =>
  Effect.map(
    Effect.exit(effect),
    (exit) => Exit.match(exit, { onFailure: (cause) => Cause.findErrorOption(cause), onSuccess: () => Option.none() }),
  )

const changedSince = (
  root: string,
  ref: string,
): Effect.Effect<
  GitDiffSchema.GitDiffResult,
  GitDiffSchema.GitDiffError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | GitDiff.GitDiff
> => Effect.flatMap(GitDiff.GitDiff, (git) => git.changedSince({ cwd: root, ref }))

const removeRepo = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })))

Feature('Reading a repository diff since a git ref')
  .withLayer(Cli.platformLayer)
  .live('the scenarios spawn real git in a temporary repository')
  .body(({ scenario }) => {
    scenario(
      'A ref reports the changed hunks, deleted-only hunks and untracked files',
      Gherkin.Do.pipe(
        Given('a temporary repository with an edited file, a deleted file and an untracked file')(
          'repo',
          () => buildRepo(),
        ),
        When('the git-diff service reads the diff since HEAD')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const real = yield* changedSince(s.repo, 'HEAD')
              const fake = yield* Effect.provideService(
                Effect.flatMap(GitDiff.GitDiff, (git) => git.changedSince({ cwd: '/repo', ref: 'HEAD' })),
                GitDiff.GitDiff,
                { changedSince: () => Effect.succeed(real) },
              )
              const pwned = yield* fs.exists(path.join(s.repo, 'pwned'))
              return { real, fake, pwned }
            }).pipe(Effect.ensuring(removeRepo(s.repo))),
        ),
        Then('the parsed hunks and untracked list are as expected, and the fake reproduces them')((s, expect) =>
          expect({
            real: s.observation.real,
            fakeMatchesReal: s.observation.fake,
          }).toEqual({
            real: {
              ref: s.observation.real.ref,
              base: s.observation.real.base,
              hunks: [
                { file: 'src/gone.ts', startLine: 0, lineCount: 0 },
                { file: 'src/kept.ts', startLine: 4, lineCount: 2 },
              ],
              untrackedFiles: ['src/new.ts'],
            },
            fakeMatchesReal: s.observation.real,
          })
        ),
      ),
    )

    scenario(
      'An unknown ref is refused as a named error and a ref with shell metacharacters is never executed',
      Gherkin.Do.pipe(
        Given('a temporary repository')('repo', () => buildRepo()),
        When('the service reads a diff for an unknown ref and for a ref full of shell metacharacters')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const unresolved = yield* failureOf(changedSince(s.repo, 'no-such-ref'))
              const literal = yield* failureOf(changedSince(s.repo, '"; touch pwned #'))
              const pwned = yield* fs.exists(path.join(s.repo, 'pwned'))
              return {
                unresolvedIsNamed: Option.exists(unresolved, S.is(GitDiffSchema.GitRefUnresolved)),
                literalIsUnresolved: Option.exists(literal, S.is(GitDiffSchema.GitRefUnresolved)),
                pwned,
              }
            }).pipe(Effect.ensuring(removeRepo(s.repo))),
        ),
        Then('both refs fail as an unresolved ref and no shell command ran')((s, expect) =>
          expect(s.observation).toEqual({ unresolvedIsNamed: true, literalIsUnresolved: true, pwned: false })
        ),
      ),
    )
  })
