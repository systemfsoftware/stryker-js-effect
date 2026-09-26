import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { EphemeralStatusSchema, RememberedStatusSchema } from '../../tests/__fixtures__/incremental-diff-law.schema.js'
import { incrementalDiff, IncrementalDiffCommand, MutantRemembered, MutantToRun } from '../incremental-diff.workflow.js'
import type { FormatIdentity } from '../IncrementalDiff.schema.js'

const mutantOf = (id: Mutant.MutantId, line: number) =>
  Mutant.Mutant.make({
    id,
    fileName: Mutant.CanonicalFileName.make(`src/mutant-${line}.ts`),
    mutatorName: Mutant.MutatorName.make(`${id}-mutator`),
    replacement: '',
    location: { start: { line, column: 0 }, end: { line, column: 1 } },
  })

const IDENTITY: FormatIdentity = {
  formatId: 'typescript',
  ownerModule: '@systemfsoftware/stryker-js-instrumenter',
  ownerVersion: '1.0.0',
}

const mutantsOf = (ids: ReadonlyArray<Mutant.MutantId>): ReadonlyArray<Mutant.Mutant> =>
  ids.map((id, index) => mutantOf(id, index))

const driftedIdentity = (identity: FormatIdentity): FormatIdentity => ({
  ...identity,
  ownerVersion: `${identity.ownerVersion}-drifted`,
})

/**
 * A report written before the location-base fix stored the mutant's 1-based
 * line but a column one too high, so a remembered legacy entry carries the
 * current location's columns shifted by one and its line unchanged.
 */
const legacyLocationOf = (mutant: Mutant.Mutant) => ({
  start: { line: mutant.location.start.line, column: mutant.location.start.column + 1 },
  end: { line: mutant.location.end.line, column: mutant.location.end.column + 1 },
})

const lineDriftedLocationOf = (mutant: Mutant.Mutant) => ({
  start: { line: mutant.location.start.line + 1, column: mutant.location.start.column },
  end: { line: mutant.location.end.line + 1, column: mutant.location.end.column },
})

const previousMutantOf = (
  mutant: Mutant.Mutant,
  status: string,
  testsCompleted: number,
  location = mutant.location,
) => ({
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location,
  status,
  testsCompleted,
  coveredBy: [mutant.id],
  killedBy: [mutant.id],
})

const commandOf = (
  mutant: Mutant.Mutant,
  input: Readonly<{
    source?: string
    location?: Mutant.Location
    identity?: FormatIdentity
    claimed?: FormatIdentity
    previousTestFiles?: Record<string, { readonly source: string }>
    testIdsByRelativeFile?: Record<string, readonly string[]>
    coveringTestFilesByMutantId?: Record<string, readonly string[]>
    force?: boolean
  }>,
  status: string,
  testsCompleted: number,
) =>
  IncrementalDiffCommand.make({
    currentMutants: [mutant],
    relativeFileByMutantId: { [mutant.id]: mutant.fileName },
    previousFiles: {
      [mutant.fileName]: {
        source: input.source ?? mutant.fileName,
        mutants: [previousMutantOf(mutant, status, testsCompleted, input.location ?? mutant.location)],
        formatIdentity: input.identity ?? IDENTITY,
      },
    },
    previousTestFiles: input.previousTestFiles ?? {},
    currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
    testIdsByRelativeFile: input.testIdsByRelativeFile ?? {},
    coveringTestFilesByMutantId: input.coveringTestFilesByMutantId ?? {},
    identitiesByFile: { [mutant.fileName]: input.claimed ?? IDENTITY },
    force: input.force ?? false,
  })

const forceCommandOf = (mutants: ReadonlyArray<Mutant.Mutant>) =>
  IncrementalDiffCommand.make({
    currentMutants: [...mutants],
    relativeFileByMutantId: Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant.fileName])),
    previousFiles: {},
    previousTestFiles: {},
    currentRelativeFiles: {},
    testIdsByRelativeFile: {},
    coveringTestFilesByMutantId: {},
    identitiesByFile: {},
    force: true,
  })

describe('incrementalDiff', () => {
  it.prop(
    '∀ids_Force_≡AllToRunInInputOrder',
    { of: [S.Array(Mutant.MutantId)], subject: incrementalDiff },
    (subject, [ids]) => {
      const mutants = mutantsOf(ids)
      const result = subject(forceCommandOf(mutants))
      const isRun = S.is(MutantToRun)
      return (
        Result.isSuccess(result) &&
        result.success.length === mutants.length &&
        result.success.every((decision, index) => isRun(decision) && mutants[index]?.id === decision.mutant.id)
      )
    },
  )

  it.prop(
    '∀ilt_StableFile_≡RememberedCarriesPreviousFields',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(commandOf(mutant, {}, status, testsCompleted))
      if (!Result.isSuccess(result) || result.success.length !== 1) {
        return false
      }
      const decision = result.success[0]
      return (
        S.is(MutantRemembered)(decision) &&
        decision.mutantId === mutant.id &&
        decision.status === status &&
        decision.testsCompleted === testsCompleted &&
        decision.coveredBy?.[0] === mutant.id &&
        decision.killedBy?.[0] === mutant.id
      )
    },
  )

  it.prop(
    '∀ilt_LegacyColumnDrift_≡Remembered',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        commandOf(mutant, { location: legacyLocationOf(mutant) }, status, testsCompleted),
      )
      return (
        Result.isSuccess(result) &&
        result.success.length === 1 &&
        S.is(MutantRemembered)(result.success[0]) &&
        result.success[0].mutantId === mutant.id
      )
    },
  )

  it.prop(
    '∀il_LineDriftedPreviousKey_≡ToRun',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        commandOf(mutant, { location: lineDriftedLocationOf(mutant) }, status, testsCompleted),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_IdentityDrift_≡ToRun',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        commandOf(mutant, { claimed: driftedIdentity(IDENTITY) }, status, testsCompleted),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_MissingClaimedIdentity_≡ToRun',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: {
            [mutant.fileName]: {
              source: mutant.fileName,
              mutants: [previousMutantOf(mutant, status, testsCompleted)],
              formatIdentity: IDENTITY,
            },
          },
          previousTestFiles: {},
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: {},
          coveringTestFilesByMutantId: {},
          identitiesByFile: {},
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_MissingRecordedIdentity_≡ToRun',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, S.Finite, Mutant.PositionSchema.fields.line],
      subject: incrementalDiff,
    },
    (subject, [id, status, testsCompleted, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: {
            [mutant.fileName]: {
              source: mutant.fileName,
              mutants: [previousMutantOf(mutant, status, testsCompleted)],
            },
          },
          previousTestFiles: {},
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: {},
          coveringTestFilesByMutantId: {},
          identitiesByFile: { [mutant.fileName]: IDENTITY },
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_EphemeralStatus_≡ToRun',
    { of: [Mutant.MutantId, EphemeralStatusSchema, Mutant.PositionSchema.fields.line], subject: incrementalDiff },
    (subject, [id, status, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(commandOf(mutant, {}, status, line))
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_ChangedSourceFile_≡ToRun',
    { of: [Mutant.MutantId, RememberedStatusSchema, Mutant.PositionSchema.fields.line], subject: incrementalDiff },
    (subject, [id, status, line]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        commandOf(mutant, { source: `${mutant.fileName}~previous` }, status, line),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀ilt_ChangedCoverage_≡ToRun',
    {
      of: [Mutant.MutantId, RememberedStatusSchema, Mutant.PositionSchema.fields.line, S.NonEmptyString],
      subject: incrementalDiff,
    },
    (subject, [id, status, line, testFile]) => {
      const mutant = mutantOf(id, line)
      const result = subject(
        commandOf(
          mutant,
          {
            previousTestFiles: { [testFile]: { source: `${testFile}~previous` } },
            testIdsByRelativeFile: { [testFile]: [mutant.id] },
            coveringTestFilesByMutantId: { [mutant.id]: [testFile] },
          },
          status,
          line,
        ),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )
})
