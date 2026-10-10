import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'

import type { GitDiffError, GitDiffResult } from './git-diff.schema.js'

export interface GitDiffInput {
  readonly cwd: string
  readonly ref: string
}

export interface GitDiffShape {
  readonly changedSince: (
    input: GitDiffInput,
  ) => Effect.Effect<GitDiffResult, GitDiffError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
}

export class GitDiff extends Context.Service<GitDiff, GitDiffShape>()(
  '@systemfsoftware/stryker-js/git-diff.service/GitDiff',
) {}
