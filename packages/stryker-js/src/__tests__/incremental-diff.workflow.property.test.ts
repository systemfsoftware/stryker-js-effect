import { describe, it } from '@effect/vitest'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { incrementalDiff, IncrementalDiffCommand, MutantRemembered, MutantToRun } from '../incremental-diff.workflow.js'

const IncrementalDiffDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/IncrementalDiff')

const RememberedStatus = S.Literals(['Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored'])

const EphemeralStatus = S.Literals(['CompileError', 'RuntimeError', 'Pending'])

const shiftedLocationOf = (mutant: typeof Mutant.Type) => ({
  start: { line: mutant.location.start.line - 1, column: mutant.location.start.column - 1 },
  end: { line: mutant.location.end.line - 1, column: mutant.location.end.column - 1 },
})

const previousMutantOf = (mutant: typeof Mutant.Type, status: string, testsCompleted: number) => ({
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: shiftedLocationOf(mutant),
  status,
  testsCompleted,
  coveredBy: [mutant.id],
  killedBy: [mutant.id],
})

const carriesDecisionTypeId = (decision: unknown) =>
  Object.getOwnPropertySymbols(decision).includes(IncrementalDiffDecisionTypeId)

const forceCommandOf = (mutants: ReadonlyArray<typeof Mutant.Type>) =>
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
  it.prop('∀d_Decision_CarriesIncrementalDiffTypeId', [S.Array(Mutant)], (mutants) => {
    const result = incrementalDiff(forceCommandOf(mutants))
    return Result.isSuccess(result) && result.success.every(carriesDecisionTypeId)
  })

  it.prop('∀ms_Force_AllToRunInInputOrder', [S.Array(Mutant)], (mutants) => {
    const result = incrementalDiff(forceCommandOf(mutants))
    return (
      Result.isSuccess(result) &&
      result.success.length === mutants.length &&
      result.success.every((decision, index) =>
        S.is(MutantToRun)(decision) && mutants[index]?.id === decision.mutant.id
      )
    )
  })

  it.prop('∀mnt_StableFile_RememberedCarriesPreviousFields', [Mutant, RememberedStatus, S.Finite], ([
    mutant,
    status,
    testsCompleted,
  ]) => {
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

  it.prop('∀me_EphemeralStatus_ToRun', [Mutant, EphemeralStatus], ([mutant, status]) => {
    const previous = previousMutantOf(mutant, status, mutant.location.start.column)
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
  })

  it.prop('∀mc_ChangedSourceFile_ToRun', [Mutant, RememberedStatus], ([mutant, status]) => {
    const previous = previousMutantOf(mutant, status, mutant.location.start.column)
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
  })

  it.prop('∀mk_UnshiftedPreviousKey_ToRun', [Mutant, RememberedStatus], ([mutant, status]) => {
    const previous = { ...previousMutantOf(mutant, status, mutant.location.start.column), location: mutant.location }
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
  })

  it.prop('∀mtc_ChangedCoverage_ToRun', [Mutant, RememberedStatus, S.NonEmptyString], ([
    mutant,
    status,
    testFile,
  ]) => {
    const previous = previousMutantOf(mutant, status, mutant.location.start.column)
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
  })
})
