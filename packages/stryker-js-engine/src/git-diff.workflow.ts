import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Incremental } from '@systemfsoftware/stryker-js-contracts'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { DiffScopeCommand, DiffScoped, DiffScopeDecision, FullScope } from './git-diff.schema.js'

const LOCKFILE_BASENAMES: ReadonlyArray<string> = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]

const TEST_RUNNER_CONFIG_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:vitest|jest)\.config\.[^/]+$/,
  /^vitest\.workspace\.[^/]+$/,
  /^karma\.conf\.[^/]+$/,
  /^jasmine\.json$/,
  /^\.mocharc(?:\.[^/]+)?$/,
]

const basenameOf = (file: string): string => {
  const normalized = file.replace(/\\/g, '/')
  return Option.getOrElse(Arr.last(normalized.split('/')), () => normalized)
}

const matchesAny = (patterns: ReadonlyArray<RegExp>, value: string): boolean =>
  patterns.some((pattern) => pattern.test(value))

const isStrykerConfig = (name: string): boolean => /^stryker\.(?:conf|config)(?:\.[^/]+)?$/.test(name)

const lockfilePoisonOf = (file: string): Option.Option<string> =>
  Boolean.match(LOCKFILE_BASENAMES.includes(basenameOf(file)), {
    onTrue: () => Option.some(`manifest or lockfile changed: ${file}`),
    onFalse: () => Option.none(),
  })

const strykerConfigPoisonOf = (file: string): Option.Option<string> =>
  Boolean.match(isStrykerConfig(basenameOf(file)), {
    onTrue: () => Option.some(`Stryker configuration changed: ${file}`),
    onFalse: () => Option.none(),
  })

const testRunnerConfigPoisonOf = (file: string): Option.Option<string> =>
  Boolean.match(matchesAny(TEST_RUNNER_CONFIG_PATTERNS, basenameOf(file)), {
    onTrue: () => Option.some(`test runner configuration changed: ${file}`),
    onFalse: () => Option.none(),
  })

const poisonReasonOf = (file: string): Option.Option<string> =>
  Option.orElse(
    lockfilePoisonOf(file),
    () => Option.orElse(strykerConfigPoisonOf(file), () => testRunnerConfigPoisonOf(file)),
  )

const changedFilesOf = (command: DiffScopeCommand): ReadonlyArray<string> => [
  ...command.hunks.map((hunk) => hunk.file),
  ...command.untrackedFiles,
]

const firstPoisonOf = (
  files: ReadonlyArray<string>,
): Option.Option<{ readonly file: string; readonly reason: string }> =>
  Arr.head(files.flatMap((file) => Option.toArray(Option.map(poisonReasonOf(file), (reason) => ({ file, reason })))))

const rangeOf = (hunk: Incremental.DiffHunk): Option.Option<string> =>
  Boolean.match(hunk.lineCount > 0, {
    onTrue: () => Option.some(`${hunk.file}:${hunk.startLine}-${hunk.startLine + hunk.lineCount - 1}`),
    onFalse: () => Option.none(),
  })

const rangesOf = (command: DiffScopeCommand): ReadonlyArray<string> => [
  ...command.hunks.flatMap((hunk) => Option.toArray(rangeOf(hunk))),
  ...command.untrackedFiles,
]

const decisionOf = (command: DiffScopeCommand): DiffScopeDecision =>
  Option.match(firstPoisonOf(changedFilesOf(command)), {
    onSome: (poison) => FullScope.make({ reason: poison.reason }),
    onNone: () => DiffScoped.make({ ranges: rangesOf(command) }),
  })

export const gitDiff = Workflow.make({
  command: DiffScopeCommand,
  decision: DiffScopeDecision,
  error: S.Never,
  decide: (command: DiffScopeCommand): Result.Result<DiffScopeDecision, never> => Result.succeed(decisionOf(command)),
})
