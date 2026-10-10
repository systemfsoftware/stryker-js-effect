import * as S from 'effect/Schema'

const NonNegativeInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

export const DiffHunk = S.Struct({
  file: S.String,
  startLine: NonNegativeInt,
  lineCount: NonNegativeInt,
})

export type DiffHunk = typeof DiffHunk.Type

export const GitDiffResult = S.Struct({
  ref: S.String,
  base: S.String,
  hunks: S.Array(DiffHunk),
  untrackedFiles: S.Array(S.String),
})

export type GitDiffResult = typeof GitDiffResult.Type

export class GitRefUnresolved extends S.TaggedError<GitRefUnresolved>()('GitRefUnresolved', {
  ref: S.String,
  detail: S.String,
}) {
  override get message(): string {
    return `Cannot resolve git ref "${this.ref}": ${this.detail}`
  }
}

export class GitCommandFailed extends S.TaggedError<GitCommandFailed>()('GitCommandFailed', {
  command: S.String,
  detail: S.String,
}) {
  override get message(): string {
    return `git ${this.command} failed: ${this.detail}`
  }
}

export type GitDiffError = GitRefUnresolved | GitCommandFailed
