import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as S from 'effect/Schema'

const NonNegativeInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

const DiffScopeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/DiffScopeDecision')
type DiffScopeTypeId = typeof DiffScopeTypeId

export const DiffHunk = S.Struct({
  file: S.String,
  startLine: NonNegativeInt,
  lineCount: NonNegativeInt,
})

export type DiffHunk = typeof DiffHunk.Type

export const GitDiffResult = S.Struct({
  ref: S.String,
  base: S.String,
  head: S.String,
  hunks: S.Array(DiffHunk),
  untrackedFiles: S.Array(S.String),
})

export type GitDiffResult = typeof GitDiffResult.Type

export class GitRefUnresolved extends S.TaggedError<GitRefUnresolved>()('GitRefUnresolved', {
  ref: S.String,
  detail: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

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

export class DiffScopeCommand extends S.TaggedClass<DiffScopeCommand>()('DiffScopeCommand', {
  hunks: S.Array(DiffHunk),
  untrackedFiles: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DiffScoped extends S.TaggedClass<DiffScoped>()('DiffScoped', {
  ranges: S.Array(S.String),
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export class FullScope extends S.TaggedClass<FullScope>()('FullScope', {
  reason: S.String,
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export const DiffScopeDecision = S.Union([DiffScoped, FullScope])
export type DiffScopeDecision = typeof DiffScopeDecision.Type

export const WholeProject = S.TaggedStruct('WholeProject', {})

export const ChangedSince = S.TaggedStruct('ChangedSince', { diff: GitDiffResult })

export const PlannedDiff = S.Union([WholeProject, ChangedSince])
export type PlannedDiff = typeof PlannedDiff.Type
