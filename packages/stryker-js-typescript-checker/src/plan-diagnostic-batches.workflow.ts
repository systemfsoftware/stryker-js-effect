import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanDiagnosticBatchesCommand } from './CheckerCommands.schema.js'

const DiagnosticBatchSize = 64

const BatchesTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/DiagnosticBatches')
type BatchesTypeId = typeof BatchesTypeId

export class DiagnosticBatchesPlanned extends S.TaggedClass<DiagnosticBatchesPlanned>()('DiagnosticBatchesPlanned', {
  batches: S.String.pipe(S.Array, S.Array),
}) {
  readonly [BatchesTypeId] = BatchesTypeId
}

export class NoDiagnosticBatches extends S.TaggedClass<NoDiagnosticBatches>()('NoDiagnosticBatches', {}) {
  readonly [BatchesTypeId] = BatchesTypeId
}

export const DiagnosticBatches = S.Union([DiagnosticBatchesPlanned, NoDiagnosticBatches])
export type DiagnosticBatches = typeof DiagnosticBatches.Type

const diagnosticBatchesOf = (fileNames: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.chunksOf(fileNames, DiagnosticBatchSize)

const decide = (command: PlanDiagnosticBatchesCommand): Result.Result<DiagnosticBatches, never> =>
  Result.succeed(
    Boolean.match(command.fileNames.length === 0, {
      onTrue: () => NoDiagnosticBatches.make({}),
      onFalse: () => DiagnosticBatchesPlanned.make({ batches: diagnosticBatchesOf(command.fileNames) }),
    }),
  )

export const planDiagnosticBatches = Workflow.make({
  command: PlanDiagnosticBatchesCommand,
  decision: DiagnosticBatches,
  error: S.Never,
  decide,
})
