/**
 * Compiler — declarations for the TypeScript compiler and version guard.
 *
 * The error vocabulary every compiler operation refuses with; decoded and
 * reported at the checker boundary, no I/O.
 */
import { Schema as S } from 'effect'
import * as Match from 'effect/Match'

import { TsConfigNotFoundError, TsConfigParseError } from './Tsconfig.schema.js'

/** The installed TypeScript version is below the supported floor. */
export class UnsupportedTypeScriptVersionError
  extends S.TaggedError<UnsupportedTypeScriptVersionError, { readonly brand: unique symbol }>()(
    'UnsupportedTypeScriptVersionError',
    {
      version: S.String,
    },
  )
{
  override get message(): string {
    return `@systemfsoftware/stryker-js-typescript-checker only supports typescript@7.0.0 or higher. Found typescript@${this.version}`
  }
}

/** Requested file is not present in the hybrid in-memory file map. */
export class HybridFileNotFoundError
  extends S.TaggedError<HybridFileNotFoundError, { readonly brand: unique symbol }>()(
    'HybridFileNotFoundError',
    {
      fileName: S.String,
    },
  )
{
  override get message(): string {
    return `'${this.fileName}' is part of your TypeScript project but could not be found on disk`
  }
}

export class HybridMutantOutsideFileError
  extends S.TaggedError<HybridMutantOutsideFileError, { readonly brand: unique symbol }>()(
    'HybridMutantOutsideFileError',
    {
      fileName: S.String,
    },
  )
{
  override get message(): string {
    return `A mutant's location falls outside '${this.fileName}'`
  }
}

/**
 * Every way the TypeScript compiler can fail while serving a check.
 * One tagged error — callers branch only on failure itself; `reason` keeps
 * cases distinguishable in reports.
 */
export class CompilerFailed
  extends S.TaggedError<CompilerFailed, { readonly brand: unique symbol }>()('CompilerFailed', {
    reason: S.Literals([
      'not-initialized',
      'no-projects',
      'unknown-file-node',
      'file-not-in-project',
      'mutant-outside-file',
      'program-digest-unavailable',
    ]),
    subject: S.optional(S.String),
  })
{
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
      Match.when(
        'mutant-outside-file',
        () => `A mutant's location falls outside '${this.subject ?? 'a file'}'`,
      ),
      Match.when(
        'program-digest-unavailable',
        () => `The loaded TypeScript program could not be identified: ${this.subject ?? 'unknown input'}`,
      ),
      Match.exhaustive,
    )
  }
}

export class InvalidCheckerOptions
  extends S.TaggedError<InvalidCheckerOptions, { readonly brand: unique symbol }>()('InvalidCheckerOptions', {
    detail: S.String,
  })
{
  readonly code = 'invalid-checker-options' as const
  readonly nextAction =
    "Set typescriptChecker.importerCheck to 'location-rule' or 'always', or remove it, and remove every other key from the typescriptChecker block"

  override get message(): string {
    return `typescript checker (${this.code}): the typescriptChecker options are invalid: ${this.detail}. ${this.nextAction}`
  }
}

export class DuplicateMutantIds
  extends S.TaggedError<DuplicateMutantIds, { readonly brand: unique symbol }>()('DuplicateMutantIds', {
    detail: S.String,
  })
{
  readonly code = 'duplicate-mutant-ids' as const
  readonly nextAction = 'Send each mutant id once per check call'

  override get message(): string {
    return `typescript checker (${this.code}): one check call named the same mutant more than once: ${this.detail}. ${this.nextAction}`
  }
}

export class DryRunCompileErrors
  extends S.TaggedError<DryRunCompileErrors, { readonly brand: unique symbol }>()('DryRunCompileErrors', {
    text: S.String,
  })
{
  override get message(): string {
    return `Typescript error(s) found in dry run compilation: ${this.text}`
  }
}

export type CompilerError =
  | CompilerFailed
  | InvalidCheckerOptions
  | DuplicateMutantIds
  | UnsupportedTypeScriptVersionError
  | TsConfigNotFoundError
  | TsConfigParseError
