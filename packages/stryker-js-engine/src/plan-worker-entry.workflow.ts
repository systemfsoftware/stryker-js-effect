import { Workflow } from '@systemfsoftware/effect-cell-types'
import { WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class WorkerEntryMissing extends S.TaggedError<WorkerEntryMissing>()('WorkerEntryMissing', {
  pluginName: S.String,
  specifier: S.String,
}) {}

const WorkerEntryDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-engine/WorkerEntryDecision')
type WorkerEntryDecisionTypeId = typeof WorkerEntryDecisionTypeId

export class WorkerEntryCommand extends S.TaggedClass<WorkerEntryCommand>()('WorkerEntryCommand', {
  kind: WorkerPluginKind,
  pluginName: S.String,
  modulePath: S.String,
  bin: S.optional(S.String),
  workerExport: S.optional(S.String),
}) {}

export class WorkerEntryFromBin extends S.TaggedClass<WorkerEntryFromBin>()('WorkerEntryFromBin', {
  relativeEntrypoint: S.String,
}) {
  readonly [WorkerEntryDecisionTypeId] = WorkerEntryDecisionTypeId
}

export class WorkerEntryFromWorkerExport extends S.TaggedClass<WorkerEntryFromWorkerExport>()(
  'WorkerEntryFromWorkerExport',
  {
    relativeEntrypoint: S.String,
  },
) {
  readonly [WorkerEntryDecisionTypeId] = WorkerEntryDecisionTypeId
}

export type WorkerEntryDecision = WorkerEntryFromBin | WorkerEntryFromWorkerExport

const missing = (command: WorkerEntryCommand): Result.Result<WorkerEntryDecision, WorkerEntryMissing> =>
  Result.fail(new WorkerEntryMissing({ pluginName: command.pluginName, specifier: command.modulePath }))

export const planWorkerEntry = Workflow.make(
  WorkerEntryCommand,
  (command: WorkerEntryCommand): Result.Result<WorkerEntryDecision, WorkerEntryMissing> =>
    Option.match(Option.fromUndefinedOr(command.bin), {
      onSome: (relativeEntrypoint) => Result.succeed(new WorkerEntryFromBin({ relativeEntrypoint })),
      onNone: () =>
        Option.match(Option.fromUndefinedOr(command.workerExport), {
          onSome: (relativeEntrypoint) => Result.succeed(new WorkerEntryFromWorkerExport({ relativeEntrypoint })),
          onNone: () => missing(command),
        }),
    }),
)
