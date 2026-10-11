import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  abortedOutcomeOf,
  BenchReport,
  type BenchReportRun,
  LegTime,
  ProvisionalReport,
  ProvisionalRunNext,
  ProvisionalSummarizeNext,
  SetupStep,
} from './bench-report.schema.js'
import { BenchRun, BenchRunMeasured, BenchSide } from './bench-run.schema.js'
import { WithheldPins } from './lockfile-pins.schema.js'

export class ProvisionalReportCommand extends S.TaggedClass<ProvisionalReportCommand>()('ProvisionalReportCommand', {
  baseSha: S.String,
  headSha: S.String,
  ref: S.String,
  leg: LegTime,
  order: S.Array(BenchSide),
  finished: S.Array(BenchRun),
  setupSteps: S.Array(SetupStep),
  withheldPins: S.Array(WithheldPins),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const reportRunOf = (run: BenchRunMeasured): BenchReportRun => ({
  key: run.key,
  wallMs: run.wallMs,
  exitCode: run.exitCode,
  testsExecuted: run.testsExecuted,
  workloadDigest: run.workloadDigest,
})

const reportOf = (command: ProvisionalReportCommand, nextStep: string): BenchReport =>
  BenchReport.make({
    schemaVersion: '2.0',
    baseSha: command.baseSha,
    headSha: command.headSha,
    ref: command.ref,
    leg: command.leg,
    outcome: abortedOutcomeOf(
      'leg-incomplete',
      `${command.finished.length} of ${command.order.length} runs finished; next step: ${nextStep}`,
    ),
    runs: Arr.map(Arr.filter(command.finished, S.is(BenchRunMeasured)), reportRunOf),
    setupSteps: [...command.setupSteps],
    withheldPins: [...command.withheldPins],
  })

const provisionalOf = (command: ProvisionalReportCommand): ProvisionalReport => {
  const position = command.finished.length
  return Option.match(Arr.get(command.order, position), {
    onNone: (): ProvisionalReport =>
      ProvisionalSummarizeNext.make({
        report: reportOf(command, 'summarizing the runs and writing the final report'),
      }),
    onSome: (side): ProvisionalReport =>
      ProvisionalRunNext.make({
        report: reportOf(command, `run ${position + 1} of ${command.order.length} (side ${side})`),
        position,
        side,
      }),
  })
}

const decide = (command: ProvisionalReportCommand): Result.Result<ProvisionalReport, never> =>
  Result.succeed(provisionalOf(command))

export const provisionalReport = Workflow.make({
  command: ProvisionalReportCommand,
  decision: ProvisionalReport,
  error: S.Never,
  decide,
})
