import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  type CheckpointMutantRow,
  checkpointMutants,
  CheckpointMutantsCommand,
  CheckpointPendingMutant,
  CheckpointSettledMutant,
} from '../checkpoint-mutants.workflow.js'

const SUBJECT_FILE = 'src/subject.ts'

const hexIdOf = (index: number): Mutant.MutantId => Mutant.MutantId.make(index.toString(16).padStart(16, '0'))

const mutantOf = (index: number): Mutant.Mutant =>
  Mutant.Mutant.make({
    id: hexIdOf(index),
    fileName: Mutant.CanonicalFileName.make(SUBJECT_FILE),
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: `${index}`,
    location: { start: { line: index + 1, column: 1 }, end: { line: index + 1, column: 2 } },
  })

const commandOf = (reached: ReadonlyArray<Mutant.RememberedStatus | null>): CheckpointMutantsCommand =>
  CheckpointMutantsCommand.make({
    plannedMutants: reached.map((_, index) => mutantOf(index)),
    settled: reached.flatMap((status, index) =>
      status === null ? [] : [CheckpointSettledMutant.make({ mutant: mutantOf(index), status })]
    ),
  })

const maxRows = { maxLength: 5 }

const checkpointCommandArb = Arbitrary.array(Arbitrary.schema(S.NullOr(Mutant.RememberedStatusSchema)), maxRows).pipe(
  Arbitrary.map(commandOf),
)

const allSettledCommandArb = Arbitrary.array(Arbitrary.schema(Mutant.RememberedStatusSchema), maxRows).pipe(
  Arbitrary.map(commandOf),
)

const settledIdsOf = (command: CheckpointMutantsCommand) => new Set(command.settled.map((row) => row.mutant.id))

const rowsByIdOf = (rows: ReadonlyArray<CheckpointMutantRow>): Record<string, CheckpointMutantRow> =>
  Object.fromEntries(rows.map((row) => [row.mutant.id, row] as const))

describe('checkpointMutants', () => {
  it.prop(
    '∀c_Rows_≡CoverEveryPlannedMutantOnceInPlannedOrder',
    { of: [checkpointCommandArb], subject: checkpointMutants },
    (subject, [command]) => {
      const result = subject(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      const plannedIds = command.plannedMutants.map((mutant) => mutant.id)
      return result.success.length === plannedIds.length &&
        result.success.every((row, index) => row.mutant.id === plannedIds[index])
    },
  )

  it.prop(
    '∀c_Settled_≡KeepsItsStatusAndIsNeverPending',
    { of: [checkpointCommandArb], subject: checkpointMutants },
    (subject, [command]) => {
      const result = subject(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      const rowsById = rowsByIdOf(result.success)
      const settledIds = settledIdsOf(command)
      return command.settled.every((settled) => {
        const row = rowsById[settled.mutant.id]
        return row !== undefined &&
          S.is(CheckpointSettledMutant)(row) &&
          row.status === settled.status &&
          JSON.stringify(row.killedBy ?? []) === JSON.stringify(settled.killedBy ?? [])
      }) &&
        result.success.every((row) => !S.is(CheckpointPendingMutant)(row) || !settledIds.has(row.mutant.id))
    },
  )

  it.prop(
    '∀c_Unsettled_≡Pending',
    { of: [checkpointCommandArb], subject: checkpointMutants },
    (subject, [command]) => {
      const result = subject(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      const settledIds = settledIdsOf(command)
      return result.success.every((row) => settledIds.has(row.mutant.id) || S.is(CheckpointPendingMutant)(row))
    },
  )

  it.prop(
    '∀c_AllSettled_≡NoPendingRow',
    { of: [allSettledCommandArb], subject: checkpointMutants },
    (subject, [command]) => {
      const result = subject(command)
      return Result.isSuccess(result) && result.success.every((row) => !S.is(CheckpointPendingMutant)(row))
    },
  )
})
