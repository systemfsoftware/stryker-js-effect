import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Array from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { OutputMode } from '@systemfsoftware/stryker-js-cli-contract'
import { HumanStreamRole, MachineStreamRole } from './reporter-role.schema.js'

const ReporterPlanTypeId = Symbol.for('@systemfsoftware/stryker-js/ReporterPlanDecision')
type ReporterPlanTypeId = typeof ReporterPlanTypeId

const STREAM_REPORTER = MachineStreamRole.literal
const HUMAN_REPORTER = HumanStreamRole.literal

const asHumanReporter = (name: string): string =>
  Boolean.match(name === STREAM_REPORTER, { onTrue: () => HUMAN_REPORTER, onFalse: () => name })

const humanReportersFrom = (configured: readonly string[]): readonly string[] => [
  ...Array.dedupe(configured.map(asHumanReporter)),
]

const machineReportersFrom = (configured: readonly string[], stdout: readonly string[]): readonly string[] => {
  const permitted = configured.filter((name) => !stdout.includes(name))
  return Boolean.match(permitted.includes(STREAM_REPORTER), {
    onTrue: () => permitted,
    onFalse: () => [...permitted, STREAM_REPORTER],
  })
}

export class ReporterPlanCommand
  extends S.TaggedClass<ReporterPlanCommand, { readonly brand: unique symbol }>()('ReporterPlanCommand', {
    configured: S.Array(S.String),
    stdout: S.Array(S.String),
    mode: OutputMode.OutputMode,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {
    mode: 'stryker.reporter_plan.mode',
  } as const
}

export class HumanReporters
  extends S.TaggedClass<HumanReporters, { readonly brand: unique symbol }>()('HumanReporters', {
    reporters: S.Array(S.String),
  })
{
  readonly [ReporterPlanTypeId] = ReporterPlanTypeId
}

export class MachineReporters
  extends S.TaggedClass<MachineReporters, { readonly brand: unique symbol }>()('MachineReporters', {
    reporters: S.Array(S.String),
  })
{
  readonly [ReporterPlanTypeId] = ReporterPlanTypeId
}

export const ReporterPlanDecision = S.Union([HumanReporters, MachineReporters])
export type ReporterPlanDecision = typeof ReporterPlanDecision.Type

export const planReporters = Workflow.make({
  command: ReporterPlanCommand,
  decision: ReporterPlanDecision,
  error: S.Never,
  decide: (command): Result.Result<ReporterPlanDecision, never> =>
    Match.value(command.mode).pipe(
      Match.when('human', () =>
        Result.succeed(HumanReporters.make({ reporters: [...humanReportersFrom(command.configured)] }))),
      Match.when('machine', () =>
        Result.succeed(
          MachineReporters.make({ reporters: [...machineReportersFrom(command.configured, command.stdout)] }),
        )),
      Match.exhaustive,
    ),
})
