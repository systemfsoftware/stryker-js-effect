import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import {
  DiffHunk,
  GitCommandFailed,
  type GitDiffError,
  type GitDiffResult,
  GitRefUnresolved,
} from './git-diff.schema.js'

export interface GitDiffInput {
  readonly cwd: string
  readonly ref: string
}

export interface GitDiffShape {
  readonly changedSince: (
    input: GitDiffInput,
  ) => Effect.Effect<GitDiffResult, GitDiffError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
}

interface GitRun {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

type GitEnv = ChildProcessSpawner.ChildProcessSpawner | Scope.Scope

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
const NEW_FILE = /^\+\+\+ (?!\/dev\/null)(.+)$/
const OLD_FILE = /^--- (?!\/dev\/null)(.+)$/

const captureOf = (regex: RegExp, line: string): string =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullOr(regex.exec(line)), (match) => Option.fromUndefinedOr(match[1])),
    () => '',
  )

const numberAt = (match: RegExpExecArray, index: number, fallback: number): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(match[index]), (value) => Option.some(Number(value))),
    () => fallback,
  )

const stripPathPrefix = (value: string): string =>
  Boolean.match(value.startsWith('a/'), {
    onTrue: () => value.slice(2),
    onFalse: () => Boolean.match(value.startsWith('b/'), { onTrue: () => value.slice(2), onFalse: () => value }),
  })

const unquote = (value: string): string =>
  Boolean.match(value.startsWith('"'), {
    onTrue: () => Option.getOrElse(S.decodeOption(S.fromJsonString(S.String))(value), () => value),
    onFalse: () => value,
  })

const pathOf = (raw: string): string => stripPathPrefix(unquote(raw))

interface ParserState {
  readonly file: string | undefined
  readonly awaitingPath: boolean
  readonly hunks: ReadonlyArray<DiffHunk>
}

const withOldPath = (state: ParserState, line: string): ParserState =>
  Boolean.match(state.awaitingPath, {
    onTrue: () => ({ ...state, file: pathOf(captureOf(OLD_FILE, line)) }),
    onFalse: () => state,
  })

const withNewPath = (state: ParserState, line: string): ParserState =>
  Boolean.match(state.awaitingPath, {
    onTrue: () => ({ ...state, file: pathOf(captureOf(NEW_FILE, line)), awaitingPath: false }),
    onFalse: () => state,
  })

const withHunk = (state: ParserState, line: string): ParserState =>
  Option.match(Option.fromNullOr(HUNK_HEADER.exec(line)), {
    onNone: () => state,
    onSome: (match) => ({
      ...state,
      awaitingPath: false,
      hunks: Option.match(Option.fromUndefinedOr(state.file), {
        onNone: () => state.hunks,
        onSome: (file) => [
          ...state.hunks,
          { file, startLine: numberAt(match, 1, 0), lineCount: numberAt(match, 2, 1) },
        ],
      }),
    }),
  })

const step = (state: ParserState, line: string): ParserState =>
  Match.value(line).pipe(
    Match.when((candidate) => candidate.startsWith('diff --git '), () => ({ ...state, awaitingPath: true })),
    Match.when((candidate) => OLD_FILE.test(candidate), (candidate) => withOldPath(state, candidate)),
    Match.when((candidate) => NEW_FILE.test(candidate), (candidate) => withNewPath(state, candidate)),
    Match.when((candidate) => HUNK_HEADER.test(candidate), (candidate) => withHunk(state, candidate)),
    Match.orElse(() => state),
  )

const parseHunks = (output: string): ReadonlyArray<DiffHunk> =>
  output.split('\n').reduce(step, { file: undefined, awaitingPath: false, hunks: [] }).hunks

const runGit = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<GitRun, GitCommandFailed, GitEnv> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* ChildProcess.make('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
    const stdout = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
    const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString)
    const exitCode = Number(yield* handle.exitCode)
    return { stdout, stderr, exitCode }
  }).pipe(
    Effect.catchTag('PlatformError', (cause) =>
      Effect.fail(GitCommandFailed.make({ command: `git ${args.join(' ')}`, detail: cause.message }))),
  )

const resolveBase = (input: GitDiffInput): Effect.Effect<string, GitDiffError, GitEnv> =>
  Effect.gen(function*() {
    const ran = yield* runGit(input.cwd, ['merge-base', input.ref, 'HEAD'])
    return yield* Boolean.match(ran.exitCode !== 0, {
      onTrue: () => GitRefUnresolved.make({ ref: input.ref, detail: ran.stderr.trim() }),
      onFalse: () => Effect.succeed(ran.stdout.trim()),
    })
  })

const readHunks = (cwd: string, base: string): Effect.Effect<ReadonlyArray<DiffHunk>, GitDiffError, GitEnv> =>
  Effect.gen(function*() {
    const ran = yield* runGit(cwd, ['diff', '--unified=0', base])
    return yield* Boolean.match(ran.exitCode !== 0, {
      onTrue: () => GitCommandFailed.make({ command: `git diff --unified=0 ${base}`, detail: ran.stderr.trim() }),
      onFalse: () => Effect.succeed(parseHunks(ran.stdout)),
    })
  })

const readUntracked = (cwd: string): Effect.Effect<ReadonlyArray<string>, GitDiffError, GitEnv> =>
  Effect.gen(function*() {
    const ran = yield* runGit(cwd, ['ls-files', '--others', '--exclude-standard'])
    return yield* Boolean.match(ran.exitCode !== 0, {
      onTrue: () =>
        GitCommandFailed.make({ command: 'git ls-files --others --exclude-standard', detail: ran.stderr.trim() }),
      onFalse: () =>
        Effect.succeed(ran.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)),
    })
  })

const changedSince = (input: GitDiffInput): Effect.Effect<GitDiffResult, GitDiffError, GitEnv> =>
  Effect.gen(function*() {
    const base = yield* resolveBase(input)
    const hunks = yield* readHunks(input.cwd, base)
    const untrackedFiles = yield* readUntracked(input.cwd)
    return { ref: input.ref, base, hunks, untrackedFiles }
  })

export class GitDiff extends Context.Service<GitDiff, GitDiffShape>()(
  '@systemfsoftware/stryker-js/git-diff.service/GitDiff',
) {
  static readonly layer: Layer.Layer<GitDiff> = Layer.succeed(GitDiff, { changedSince })
}
