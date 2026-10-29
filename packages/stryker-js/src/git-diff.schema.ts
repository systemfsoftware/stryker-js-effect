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
  hunks: S.Array(DiffHunk),
  untrackedFiles: S.Array(S.String),
})

export type GitDiffResult = typeof GitDiffResult.Type

export class GitRefUnresolved
  extends S.TaggedError<GitRefUnresolved, { readonly brand: unique symbol }>()('GitRefUnresolved', {
    ref: S.String,
    detail: S.String,
  })
{
  override get message(): string {
    return `Cannot resolve git ref "${this.ref}": ${this.detail}`
  }
}

export class GitCommandFailed
  extends S.TaggedError<GitCommandFailed, { readonly brand: unique symbol }>()('GitCommandFailed', {
    command: S.String,
    detail: S.String,
  })
{
  override get message(): string {
    return `git ${this.command} failed: ${this.detail}`
  }
}

export type GitDiffError = GitRefUnresolved | GitCommandFailed

export class DiffScopeCommand
  extends S.TaggedClass<DiffScopeCommand, { readonly brand: unique symbol }>()('DiffScopeCommand', {
    hunks: S.Array(DiffHunk),
    untrackedFiles: S.Array(S.String),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DiffScoped extends S.TaggedClass<DiffScoped, { readonly brand: unique symbol }>()('DiffScoped', {
  ranges: S.Array(S.String),
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export class FullScope extends S.TaggedClass<FullScope, { readonly brand: unique symbol }>()('FullScope', {
  reason: S.String,
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export const DiffScopeDecision = S.Union([DiffScoped, FullScope])
export type DiffScopeDecision = typeof DiffScopeDecision.Type
