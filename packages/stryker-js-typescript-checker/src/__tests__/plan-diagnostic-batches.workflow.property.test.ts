import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
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
})
