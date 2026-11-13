import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, GitDiff, GitDiffSchema } from '@systemfsoftware/stryker-js'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import { committerArgs, CONTRACT_GIT_IDENTITY, execGit, writeFile } from './__fixtures__/git-repo.fixture.js'

const Feature = makeFeature({ it })

const COMMITTER = committerArgs(CONTRACT_GIT_IDENTITY)

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

const sourceDigest = (
  root: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<
  string,
  GitDiffSchema.GitCommandFailed,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | GitDiff.GitDiff
> => Effect.flatMap(GitDiff.GitDiff, (git) => git.sourceDigest({ cwd: root, paths }))

const removeRepo = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })))

Feature('Reading a repository diff since a git ref')
  .withLayer(Engine.nodePlatformLayer)
  .live('the scenarios spawn real git in a temporary repository')
  .body(({ scenario }) => {
    scenario(
      'A ref reports the changed hunks, deleted-only hunks and untracked files',
      Gherkin.Do.pipe(
        Given('a temporary repository with an edited file, a deleted file and an untracked file')(
          'repo',
          () => buildRepo(),
        ),
        When('the git-diff service reads the diff since HEAD from the root and from src/')(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const path = yield* Path.Path
              const real = yield* changedSince(s.repo, 'HEAD')
              const fromSrc = yield* changedSince(path.join(s.repo, 'src'), 'HEAD')
              return { real, fromSrc }
            }).pipe(Effect.ensuring(removeRepo(s.repo))),
        ),
        Then(
          'hunks and untracked files read the same from the root and from src/, at the commit HEAD names',
        )((s, expect) =>
          expect({ real: s.observation.real, fromSrc: s.observation.fromSrc }).toEqual({
            real: {
              ref: 'HEAD',
              base: s.observation.real.head,
              head: expect.stringMatching(/^[0-9a-f]{40}$/),
              hunks: [
                { file: 'src/gone.ts', startLine: 0, lineCount: 0 },
                { file: 'src/kept.ts', startLine: 4, lineCount: 2 },
              ],
              untrackedFiles: ['src/new.ts'],
            },
            fromSrc: {
              ref: 'HEAD',
              base: s.observation.real.base,
              head: s.observation.real.head,
              hunks: [
                { file: 'gone.ts', startLine: 0, lineCount: 0 },
                { file: 'kept.ts', startLine: 4, lineCount: 2 },
              ],
              untrackedFiles: ['new.ts'],
            },
          })
        ),
      ),
    )

    scenario(
      'The source digest follows exactly the files it names',
      Gherkin.Do.pipe(
        Given('a temporary repository')('repo', () => buildRepo()),
        When(
          'the service digests the named file, after an unrelated edit, after a named edit, an absent path, and from src/',
        )(
          'observation',
          (s) =>
            Effect.gen(function*() {
              const path = yield* Path.Path
              const named = yield* sourceDigest(s.repo, ['src/kept.ts'])
              yield* writeFile(s.repo, 'src/new.ts', 'const unrelated = 2\n')
              const afterUnrelated = yield* sourceDigest(s.repo, ['src/kept.ts'])
              yield* writeFile(s.repo, 'src/kept.ts', 'const a = 1\n')
              const afterNamed = yield* sourceDigest(s.repo, ['src/kept.ts'])
              const absent = yield* sourceDigest(s.repo, ['src/absent.ts'])
              const fromSrc = yield* sourceDigest(path.join(s.repo, 'src'), ['src/kept.ts'])
              return { named, afterUnrelated, afterNamed, absent, fromSrc }
            }).pipe(Effect.ensuring(removeRepo(s.repo))),
        ),
        Then(
          'the digest is a sha256 that ignores the unrelated file, moves with the named file and reads the same from either directory',
        )((s, expect) =>
          expect({
            isSha256: /^[0-9a-f]{64}$/.test(s.observation.named),
            unrelatedEditLeavesDigest: s.observation.afterUnrelated === s.observation.named,
            namedEditMovesDigest: s.observation.afterNamed !== s.observation.named,
            absentDiffersFromNamed: s.observation.absent !== s.observation.named,
            sameFromEitherDirectory: s.observation.fromSrc === s.observation.afterNamed,
          }).toEqual({
            isSha256: true,
            unrelatedEditLeavesDigest: true,
            namedEditMovesDigest: true,
            absentDiffersFromNamed: true,
            sameFromEitherDirectory: true,
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
