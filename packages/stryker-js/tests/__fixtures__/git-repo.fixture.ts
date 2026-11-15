import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

export interface GitIdentity {
  readonly email: string
  readonly name: string
}

export const CONTRACT_GIT_IDENTITY: GitIdentity = { email: 'contract@test', name: 'contract' }

export const committerArgs = (identity: GitIdentity): ReadonlyArray<string> => [
  '-c',
  `user.email=${identity.email}`,
  '-c',
  `user.name=${identity.name}`,
]

const gitOutputWith = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make('git', args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }),
    )
    const stdout = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
    const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString)
    const exitCode = Number(yield* handle.exitCode)
    yield* Effect.when(
      Effect.die(new Error(`git ${args.join(' ')} failed (${exitCode}): ${stderr}`)),
      Effect.succeed(exitCode !== 0),
    )
    return stdout.trim()
  }).pipe(Effect.orDie)

export const gitOutput: {
  (
    cwd: string,
    args: ReadonlyArray<string>,
  ): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
  (
    args: ReadonlyArray<string>,
  ): (cwd: string) => Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
} = dual(2, gitOutputWith)

const execGitWith = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.asVoid(gitOutput(cwd, args))

export const execGit: {
  (
    cwd: string,
    args: ReadonlyArray<string>,
  ): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
  (
    args: ReadonlyArray<string>,
  ): (cwd: string) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
} = dual(2, execGitWith)

const writeFileWith = (
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

export const writeFile: {
  (root: string, file: string, content: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>
  (
    file: string,
    content: string,
  ): (root: string) => Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>
} = dual(3, writeFileWith)
