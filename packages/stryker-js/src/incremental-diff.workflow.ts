import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { FormatIdentitySchema, PreviousFilesSchema, PreviousTestFilesSchema } from './IncrementalDiff.schema.js'
import type {
  FormatIdentity,
  PreviousFileRecord,
  PreviousMutantRecord,
  PreviousTestFileRecord,
} from './IncrementalDiff.schema.js'

const REMEMBERED_STATUS: ReadonlySet<string> = new Set(['Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored'])

const NO_PREVIOUS_MUTANTS: readonly PreviousMutantRecord[] = []

const IncrementalDiffTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/IncrementalDiff')
type IncrementalDiffTypeId = typeof IncrementalDiffTypeId

export class IncrementalDiffCommand extends S.TaggedClass<IncrementalDiffCommand>()('IncrementalDiffCommand', {
  currentMutants: S.Array(Mutant.Mutant),
  relativeFileByMutantId: S.Record(S.String, S.String),
  previousFiles: PreviousFilesSchema,
  previousTestFiles: PreviousTestFilesSchema,
  currentRelativeFiles: S.Record(S.String, S.String),
  testIdsByRelativeFile: S.Record(S.String, S.Array(S.String)),
  coveringTestFilesByMutantId: S.Record(S.String, S.Array(S.String)),
  identitiesByFile: S.Record(S.String, FormatIdentitySchema),
  force: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    force: 'stryker.incremental_diff.force',
  } as const
}

export class MutantRemembered extends S.TaggedClass<MutantRemembered>()('MutantRemembered', {
  mutantId: Mutant.MutantId,
  status: S.String,
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export class MutantToRun extends S.TaggedClass<MutantToRun>()('MutantToRun', {
  mutant: Mutant.Mutant,
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export type IncrementalDiffDecision = MutantRemembered | MutantToRun

type KeyLocation = { readonly line: number; readonly column: number }

const mutantKeyOf = (mutatorName: string, replacement: string, start: KeyLocation, end: KeyLocation) =>
  `${mutatorName}\u0000${replacement}\u0000${start.line}:${start.column}:${end.line}:${end.column}`

type KeyedMutant = {
  readonly mutatorName: string
  readonly replacement: string
  readonly location: { readonly start: KeyLocation; readonly end: KeyLocation }
}

const currentMutantKey = (mutant: KeyedMutant) =>
  mutantKeyOf(mutant.mutatorName, mutant.replacement, mutant.location.start, mutant.location.end)

/**
 * Reports written before the location-base fix stored correct 1-based lines
 * but columns one too high, so a prior entry maps into the current key
 * space by subtracting one from the columns only. New reports already
 * persist the 1-based form and match through `currentMutantKey` directly;
 * this fallback only ever reads, and drops out once the next full run
 * rewrites the file.
 */
const previousMutantKey = (mutant: KeyedMutant) =>
  mutantKeyOf(
    mutant.mutatorName,
    mutant.replacement,
    { line: mutant.location.start.line, column: mutant.location.start.column - 1 },
    { line: mutant.location.end.line, column: mutant.location.end.column - 1 },
  )

const changedSourceFiles = (
  previousFiles: Readonly<Record<string, PreviousFileRecord>>,
  currentRelativeFiles: Readonly<Record<string, string>>,
) =>
  Object.entries(previousFiles)
    .filter(([name, previous]) => previous.source !== currentRelativeFiles[name])
    .map(([name]) => name)

const changedTestFiles = (
  previousTestFiles: Readonly<Record<string, PreviousTestFileRecord>>,
  currentRelativeFiles: Readonly<Record<string, string>>,
  testIdsByRelativeFile: Readonly<Record<string, readonly string[]>>,
) =>
  Object.keys({ ...previousTestFiles, ...testIdsByRelativeFile }).filter((name) =>
    Option.match(Option.fromUndefinedOr(previousTestFiles[name]), {
      onNone: () => currentRelativeFiles[name] !== undefined,
      onSome: (record) => record.source !== currentRelativeFiles[name],
    })
  )

const findRemembered = (
  previousFiles: Readonly<Record<string, PreviousFileRecord>>,
  file: string,
  key: string,
) =>
  Option.getOrElse(
    Option.flatMap(
      Record.get(previousFiles, file),
      (record) => Option.fromUndefinedOr(record.mutants),
    ),
    () => NO_PREVIOUS_MUTANTS,
  ).find((candidate) => [previousMutantKey(candidate), currentMutantKey(candidate)].includes(key))

const hasChangedCoverage = (
  mutantId: string,
  coveringTestFilesByMutantId: Readonly<Record<string, readonly string[]>>,
  changedTests: readonly string[],
) =>
  Option.getOrElse(Record.get(coveringTestFilesByMutantId, mutantId), () => []).some((file) =>
    changedTests.includes(file)
  )

const sameIdentity = (left: FormatIdentity, right: FormatIdentity): boolean =>
  [
    left.formatId === right.formatId,
    left.ownerModule === right.ownerModule,
    left.ownerVersion === right.ownerVersion,
  ].every((same) => same)

const fileIdentityReuses = (command: IncrementalDiffCommand, file: string): boolean =>
  Option.match(Record.get(command.previousFiles, file), {
    onNone: () => false,
    onSome: (previous) =>
      Option.match(
        Option.all({
          recorded: Option.fromUndefinedOr(previous.formatIdentity),
          claimed: Record.get(command.identitiesByFile, file),
        }),
        {
          onNone: () => false,
          onSome: ({ recorded, claimed }) => sameIdentity(recorded, claimed),
        },
      ),
  })

const isRememberable = (
  previous: PreviousMutantRecord,
  mutant: Mutant.Mutant,
  input: IncrementalDiffCommand,
  file: string,
  changedFiles: readonly string[],
  changedTests: readonly string[],
) =>
  Boolean.match(REMEMBERED_STATUS.has(previous.status), {
    onTrue: () =>
      Boolean.match(fileIdentityReuses(input, file), {
        onTrue: () =>
          Boolean.match(changedFiles.includes(file), {
            onTrue: () => false,
            onFalse: () => !hasChangedCoverage(mutant.id, input.coveringTestFilesByMutantId, changedTests),
          }),
        onFalse: () => false,
      }),
    onFalse: () => false,
  })

const rememberedOf = (mutant: Mutant.Mutant, previous: PreviousMutantRecord) =>
  MutantRemembered.make({
    mutantId: mutant.id,
    status: previous.status,
    ...Option.match(Option.fromUndefinedOr(previous.testsCompleted), {
      onNone: () => ({}),
      onSome: (testsCompleted) => ({ testsCompleted }),
    }),
    ...Option.match(Option.fromUndefinedOr(previous.coveredBy), {
      onNone: () => ({}),
      onSome: (coveredBy) => ({ coveredBy }),
    }),
    ...Option.match(Option.fromUndefinedOr(previous.killedBy), {
      onNone: () => ({}),
      onSome: (killedBy) => ({ killedBy }),
    }),
  })

const decideForMutant = (
  mutant: Mutant.Mutant,
  input: IncrementalDiffCommand,
  changedFiles: readonly string[],
  changedTests: readonly string[],
): IncrementalDiffDecision => {
  const file = Option.getOrElse(
    Record.get(input.relativeFileByMutantId, mutant.id),
    () => mutant.fileName,
  )
  const previous = findRemembered(input.previousFiles, file, currentMutantKey(mutant))
  return Option.match(
    Option.filter(
      Option.fromUndefinedOr(previous),
      (candidate) => isRememberable(candidate, mutant, input, file, changedFiles, changedTests),
    ),
    {
      onNone: () => MutantToRun.make({ mutant }),
      onSome: (record) => rememberedOf(mutant, record),
    },
  )
}

const decideChanged = (command: IncrementalDiffCommand) => {
  const changedFiles = changedSourceFiles(command.previousFiles, command.currentRelativeFiles)
  const changedTests = changedTestFiles(
    command.previousTestFiles,
    command.currentRelativeFiles,
    command.testIdsByRelativeFile,
  )
  return command.currentMutants.map((mutant) => decideForMutant(mutant, command, changedFiles, changedTests))
}

const decide = (command: IncrementalDiffCommand): Result.Result<readonly IncrementalDiffDecision[], never> =>
  Boolean.match(command.force, {
    onTrue: () => Result.succeed(command.currentMutants.map((mutant) => MutantToRun.make({ mutant }))),
    onFalse: () => Result.succeed(decideChanged(command)),
  })

export const incrementalDiff = Workflow.make({
  command: IncrementalDiffCommand,
  decision: S.Array(S.Union([MutantRemembered, MutantToRun])),
  error: S.Never,
  decide,
})
