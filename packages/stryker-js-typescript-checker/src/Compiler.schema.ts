/**
 * Compiler — declarations for the TypeScript compiler and version guard.
 *
 * The error vocabulary every compiler operation refuses with; decoded and
 * reported at the checker boundary, no I/O.
 */
import * as Match from 'effect/Match'
import { Schema as S } from 'effect'

import { TsConfigNotFoundError, TsConfigParseError } from './Tsconfig.schema.js'

/** The installed TypeScript version is below the supported floor. */
export class UnsupportedTypeScriptVersionError extends S.TaggedError<UnsupportedTypeScriptVersionError>()(
  'UnsupportedTypeScriptVersionError',
  {
    version: S.String,
  },
) {
  override get message(): string {
    return `@systemfsoftware/stryker-js-typescript-checker only supports typescript@7.0.0 or higher. Found typescript@${this.version}`
  }
}

/** Requested file is not present in the hybrid in-memory file map. */
export class HybridFileNotFoundError extends S.TaggedError<HybridFileNotFoundError>()(
  'HybridFileNotFoundError',
  {
    fileName: S.String,
  },
) {}

/**
 * Every way the TypeScript compiler can fail while serving a check.
 * One tagged error — callers branch only on failure itself; `reason` keeps
 * cases distinguishable in reports.
 */
export class CompilerFailed extends S.TaggedError<CompilerFailed>()('CompilerFailed', {
  reason: S.Literals(['not-initialized', 'no-projects', 'unknown-file-node', 'file-not-in-project']),
  subject: S.optional(S.String),
}) {
  override get message(): string {
    return Match.value(this.reason).pipe(
      Match.when('not-initialized', () => 'The TypeScript compiler was used before it was initialized'),
      Match.when('no-projects', () => `No projects were found for ${this.subject ?? 'the tsconfig'}`),
      Match.when(
        'unknown-file-node',
        () => `The file graph has no node for '${this.subject ?? 'a file'}', which should not happen`,
      ),
      Match.when(
        'file-not-in-project',
        () => `'${this.subject ?? 'a file'}' is part of your TypeScript project but could not be found on disk`,
      ),
      Match.exhaustive,
    )
  }
}

export class DryRunCompileErrors extends S.TaggedError<DryRunCompileErrors>()('DryRunCompileErrors', {
  text: S.String,
}) {
  override get message(): string {
    return `Typescript error(s) found in dry run compilation: ${this.text}`
  }
}

export class NodeNotInGraph extends S.TaggedError<NodeNotInGraph>()('NodeNotInGraph', {
  fileName: S.String,
}) {
  override get message(): string {
    return `Node not in graph: ${this.fileName}`
  }
 }

export type CompilerError =
  | CompilerFailed
  | UnsupportedTypeScriptVersionError
  | TsConfigNotFoundError
  | TsConfigParseError
