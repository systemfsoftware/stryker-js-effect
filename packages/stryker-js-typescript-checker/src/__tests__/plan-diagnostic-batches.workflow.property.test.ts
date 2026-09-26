import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanDiagnosticBatchesCommand } from '../CheckerCommands.schema.js'
import { DiagnosticBatchesPlanned, planDiagnosticBatches } from '../plan-diagnostic-batches.workflow.js'

const BATCH_SIZE = 64

const fileNamesSchema = () => S.Array(S.String).check(S.isMaxLength(200))

const decide = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const decisionFor = (fileNames: ReadonlyArray<string>) =>
  decide(planDiagnosticBatches(PlanDiagnosticBatchesCommand.make({ fileNames: [...fileNames] })))

const batchesFor = (fileNames: ReadonlyArray<string>) => {
  const decision = decisionFor(fileNames)
  return S.is(DiagnosticBatchesPlanned)(decision) ? decision.batches : []
}

const sizeSchema = () => S.Int.check(S.isBetween({ minimum: 0, maximum: 200 }))

const boundaryNames = () => S.Array(S.String).check(S.isMinLength(1), S.isMaxLength(8))

const boundaryInputOf = (size: number, names: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from({ length: size }, (_, index) => names[index % names.length] ?? `src/generated-file-${index}.ts`)

const boundaryBatchesFor = (size: number, names: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  batchesFor(boundaryInputOf(size, names))

const plansBatches = (fileNames: ReadonlyArray<string>) => S.is(DiagnosticBatchesPlanned)(decisionFor(fileNames))

describe('planDiagnosticBatches', (it) => {
  it.prop(
    '∀files_Batches_≡PartitionWithinBatchSize',
    { of: [fileNamesSchema()], subject: batchesFor },
    (subject, [fileNames]) => {
      const batches = subject(fileNames)
      return (
        Equal.equals(Arr.flatten(batches), fileNames) &&
        Arr.every(batches, (batch) => batch.length > 0 && batch.length <= BATCH_SIZE) &&
        batches.length === Math.ceil(fileNames.length / BATCH_SIZE)
      )
    },
  )

  it.prop(
    '∀files_Batches_≡VariantByEmptiness',
    { of: [fileNamesSchema()], subject: plansBatches },
    (subject, [fileNames]) => subject(fileNames) === fileNames.length > 0,
  )

  it.prop(
    '∀size_Batches_≡FullChunksExceptLast',
    { of: [sizeSchema(), boundaryNames()], subject: boundaryBatchesFor },
    (subject, [size, names]) => {
      const fileNames = boundaryInputOf(size, names)
      const batches = subject(size, names)
      const full = Arr.dropRight(batches, 1)
      return Arr.every(
        [
          Equal.equals(Arr.flatten(batches), fileNames),
          batches.length === Math.ceil(size / BATCH_SIZE),
          Arr.every(full, (batch) => batch.length === BATCH_SIZE),
          Option.match(Arr.last(batches), {
            onNone: () => size === 0,
            onSome: (batch) => batch.length === size - full.length * BATCH_SIZE,
          }),
          HashSet.size(HashSet.fromIterable(Arr.flatten(batches))) ===
            HashSet.size(HashSet.fromIterable(fileNames)),
        ],
        (holds) => holds,
      )
    },
  )
})
