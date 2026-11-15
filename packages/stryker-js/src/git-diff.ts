import * as Result from 'effect/Result'

import { DiffScopeCommand, type DiffScopeDecision, type GitDiffResult } from './git-diff.schema.js'
import { gitDiff } from './git-diff.workflow.js'

export const diffScopeDecisionOf = (
  diff: Pick<GitDiffResult, 'hunks' | 'untrackedFiles'>,
): DiffScopeDecision =>
  Result.getOrElse(
    gitDiff(DiffScopeCommand.make({ hunks: [...diff.hunks], untrackedFiles: [...diff.untrackedFiles] })),
    (neverError) => neverError,
  )
