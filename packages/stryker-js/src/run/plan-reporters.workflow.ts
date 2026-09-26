import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Array from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ReporterPlanTypeId = Symbol.for('@systemfsoftware/stryker-js/ReporterPlanDecision')
type ReporterPlanTypeId = typeof ReporterPlanTypeId

const STREAM_REPORTER = 'progress-stream'
const HUMAN_REPORTER = 'clear-text'
const STDOUT_REPORTERS: Readonly<Record<string, true>> = { 'clear-text': true, 'progress': true }

const asHumanReporter = (name: string): string =>
  Boolean.match(name === STREAM_REPORTER, { onTrue: () => HUMAN_REPORTER, onFalse: () => name })

const humanReportersFrom = (configured: readonly string[]): readonly string[] => [
  ...Array.dedupe(configured.map(asHumanReporter)),
]

const machineReportersFrom = (configured: readonly string[]): readonly string[] => {
  const permitted = configured.filter((name) => STDOUT_REPORTERS[name] !== true)
  return Boolean.match(permitted.includes(STREAM_REPORTER), {
    onTrue: () => permitted,
    onFalse: () => [...permitted, STREAM_REPORTER],
  })
}

export class ReporterPlanCommand extends S.TaggedClass<ReporterPlanCommand>()('ReporterPlanCommand', {
  configured: S.Array(S.String),
  mode: S.Literals(['human', 'machine']),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    mode: 'stryker.reporter_plan.mode',
  } as const
}

export class HumanReporters extends S.TaggedClass<HumanReporters>()('HumanReporters', {
  reporters: S.Array(S.String),
}) {
  readonly [ReporterPlanTypeId] = ReporterPlanTypeId
}

export class MachineReporters extends S.TaggedClass<MachineReporters>()('MachineReporters', {
  reporters: S.Array(S.String),
}) {
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
        Result.succeed(MachineReporters.make({ reporters: [...machineReportersFrom(command.configured)] }))),
      Match.exhaustive,
    ),
})
