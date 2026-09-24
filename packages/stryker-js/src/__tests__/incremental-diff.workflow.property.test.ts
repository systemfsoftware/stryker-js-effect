import { describe, it } from '@effect/vitest'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { EphemeralStatusSchema, RememberedStatusSchema } from '../../tests/__fixtures__/incremental-diff-law.schema.js'
import { incrementalDiff, IncrementalDiffCommand, MutantRemembered, MutantToRun } from '../incremental-diff.workflow.js'

const mutantOf = (id: string, line: number) =>
  Mutant.Mutant.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(`src/mutant-${line}.ts`),
    mutatorName: Mutant.MutatorName.make(`${id}-mutator`),
    replacement: '',
    location: { start: { line, column: 0 }, end: { line, column: 1 } },
  })

const shiftedLocationOf = (mutant: Mutant.Mutant) => ({
  start: { line: mutant.location.start.line + 1, column: mutant.location.start.column + 1 },
  end: { line: mutant.location.end.line + 1, column: mutant.location.end.column + 1 },
})

const previousMutantOf = (mutant: Mutant.Mutant, status: string, testsCompleted: number) => ({
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: shiftedLocationOf(mutant),
  status,
  testsCompleted,
  coveredBy: [mutant.id],
  killedBy: [mutant.id],
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
    force: true,
  })

describe('incrementalDiff', () => {
  it.prop('∀ids_Force_AllToRunInInputOrder', [S.Array(S.NonEmptyString)], ([ids]) => {
    const mutants = ids.map((id, index) => mutantOf(id, index))
    const result = incrementalDiff(forceCommandOf(mutants))
    return (
      Result.isSuccess(result) &&
      result.success.length === mutants.length &&
      result.success.every((decision, index) =>
        S.is(MutantToRun)(decision) && mutants[index]?.id === decision.mutant.id
      )
    )
  })

  it.prop('∀ilt_StableFile_RememberedCarriesPreviousFields', [
    S.NonEmptyString,
    RememberedStatusSchema,
    S.Finite,
    Mutant.PositionSchema.fields.line,
  ], ([
    id,
    status,
    testsCompleted,
    line,
  ]) => {
    const mutant = mutantOf(id, line)
    const previous = previousMutantOf(mutant, status, testsCompleted)
    const result = incrementalDiff(
      IncrementalDiffCommand.make({
        currentMutants: [mutant],
        relativeFileByMutantId: { [mutant.id]: mutant.fileName },
        previousFiles: { [mutant.fileName]: { source: mutant.fileName, mutants: [previous] } },
        previousTestFiles: {},
        currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
        testIdsByRelativeFile: {},
        coveringTestFilesByMutantId: {},
        force: false,
      }),
    )
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
  })

  it.prop(
    '∀il_EphemeralStatus_ToRun',
    [S.NonEmptyString, EphemeralStatusSchema, Mutant.PositionSchema.fields.line],
    ([id, status, line]) => {
      const mutant = mutantOf(id, line)
      const previous = previousMutantOf(mutant, status, line)
      const result = incrementalDiff(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: { [mutant.fileName]: { source: mutant.fileName, mutants: [previous] } },
          previousTestFiles: {},
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: {},
          coveringTestFilesByMutantId: {},
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_ChangedSourceFile_ToRun',
    [S.NonEmptyString, RememberedStatusSchema, Mutant.PositionSchema.fields.line],
    ([id, status, line]) => {
      const mutant = mutantOf(id, line)
      const previous = previousMutantOf(mutant, status, line)
      const result = incrementalDiff(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: { [mutant.fileName]: { source: `${mutant.fileName}~previous`, mutants: [previous] } },
          previousTestFiles: {},
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: {},
          coveringTestFilesByMutantId: {},
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀il_UnshiftedPreviousKey_ToRun',
    [S.NonEmptyString, RememberedStatusSchema, Mutant.PositionSchema.fields.line],
    ([id, status, line]) => {
      const mutant = mutantOf(id, line)
      const previous = { ...previousMutantOf(mutant, status, line), location: mutant.location }
      const result = incrementalDiff(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: { [mutant.fileName]: { source: mutant.fileName, mutants: [previous] } },
          previousTestFiles: {},
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: {},
          coveringTestFilesByMutantId: {},
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )

  it.prop(
    '∀ilt_ChangedCoverage_ToRun',
    [S.NonEmptyString, RememberedStatusSchema, Mutant.PositionSchema.fields.line, S.NonEmptyString],
    ([id, status, line, testFile]) => {
      const mutant = mutantOf(id, line)
      const previous = previousMutantOf(mutant, status, line)
      const result = incrementalDiff(
        IncrementalDiffCommand.make({
          currentMutants: [mutant],
          relativeFileByMutantId: { [mutant.id]: mutant.fileName },
          previousFiles: { [mutant.fileName]: { source: mutant.fileName, mutants: [previous] } },
          previousTestFiles: { [testFile]: { source: `${testFile}~previous` } },
          currentRelativeFiles: { [mutant.fileName]: mutant.fileName },
          testIdsByRelativeFile: { [testFile]: [mutant.id] },
          coveringTestFilesByMutantId: { [mutant.id]: [testFile] },
          force: false,
        }),
      )
      return Result.isSuccess(result) && result.success.length === 1 && S.is(MutantToRun)(result.success[0])
    },
  )
})
