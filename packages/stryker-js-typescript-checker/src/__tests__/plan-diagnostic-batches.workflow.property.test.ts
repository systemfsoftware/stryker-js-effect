import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanDiagnosticBatchesCommand } from '../CheckerCommands.schema.js'
import { DiagnosticBatchesPlanned, planDiagnosticBatches } from '../plan-diagnostic-batches.workflow.js'

const BATCH_SIZE = 64

const decided = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const batchesFor = (command: PlanDiagnosticBatchesCommand): ReadonlyArray<ReadonlyArray<string>> => {
  const decision = decided(planDiagnosticBatches(command))
  return S.is(DiagnosticBatchesPlanned)(decision) ? decision.batches : []
}

const plansBatches = (command: PlanDiagnosticBatchesCommand): boolean =>
  planDiagnosticBatches(command).pipe(decided, S.is(DiagnosticBatchesPlanned))

describe('planDiagnosticBatches', (it) => {
  it.prop(
    '∀command_Batches_≡PartitionWithinBatchSize',
    { of: [PlanDiagnosticBatchesCommand], subject: batchesFor },
    (subject, [command]) => {
      const batches = subject(command)
      return (
        Equal.equals(Arr.flatten(batches), command.fileNames) &&
        Arr.every(batches, (batch) => batch.length > 0 && batch.length <= BATCH_SIZE) &&
        batches.length === Math.ceil(command.fileNames.length / BATCH_SIZE)
      )
    },
  )

  it.prop(
    '∀command_Batches_≡VariantByEmptiness',
    { of: [PlanDiagnosticBatchesCommand], subject: plansBatches },
    (subject, [command]) => subject(command) === command.fileNames.length > 0,
  )
})
