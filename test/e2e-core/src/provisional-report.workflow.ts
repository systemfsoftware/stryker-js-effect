import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  abortedOutcomeOf,
  BenchAbortCode,
  BenchReport,
  type BenchReportOutcome,
  type BenchReportRun,
  LegTime,
  ProvisionalAborted,
  ProvisionalReport,
  ProvisionalRunNext,
  ProvisionalSetupNext,
  ProvisionalSummarizeNext,
  SetupPoint,
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
  setup: S.NullOr(SetupPoint),
  abort: S.NullOr(S.Struct({ code: BenchAbortCode, reason: S.String })),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const reportRunsOf = (finished: ReadonlyArray<BenchRun>): Array<BenchReportRun> =>
  Arr.map(Arr.filter(finished, S.is(BenchRunMeasured)), (run) => ({
    key: run.key,
    wallMs: run.wallMs,
    exitCode: run.exitCode,
    testsExecuted: run.testsExecuted,
    workloadDigest: run.workloadDigest,
    identity: run.identity,
  }))

const reportOf = (command: ProvisionalReportCommand, outcome: BenchReportOutcome): BenchReport =>
  BenchReport.make({
    schemaVersion: '2.0',
    baseSha: command.baseSha,
    headSha: command.headSha,
    ref: command.ref,
    leg: command.leg,
    outcome,
    runs: reportRunsOf(command.finished),
    setupSteps: [...command.setupSteps],
    withheldPins: [...command.withheldPins],
  })

const incompleteOf = (command: ProvisionalReportCommand, nextStep: string): BenchReportOutcome =>
  abortedOutcomeOf(
    'leg-incomplete',
    `${command.finished.length} of ${command.order.length} runs finished; next step: ${nextStep}`,
  )

const runsPhaseOf = (command: ProvisionalReportCommand): ProvisionalReport => {
  const position = command.finished.length
  return Option.match(Arr.get(command.order, position), {
    onNone: (): ProvisionalReport =>
      ProvisionalSummarizeNext.make({
        report: reportOf(command, incompleteOf(command, 'summarizing the runs and writing the final report')),
      }),
    onSome: (side): ProvisionalReport =>
      ProvisionalRunNext.make({
        report: reportOf(
          command,
          incompleteOf(command, `run ${position + 1} of ${command.order.length} (side ${side})`),
        ),
        position,
        side,
      }),
  })
}

const setupStepText = (next: SetupPoint): string =>
  Match.valueTags(next, {
    start: () => 'setup',
    step: (step) => `side ${step.side} ${step.step}`,
  })

const setupPhaseOf = (command: ProvisionalReportCommand, next: SetupPoint): ProvisionalReport =>
  ProvisionalSetupNext.make({
    report: reportOf(
      command,
      abortedOutcomeOf(
        'leg-incomplete',
        `${command.setupSteps.length} setup steps measured; next step: ${setupStepText(next)}`,
      ),
    ),
    next,
  })

const inProgressOf = (command: ProvisionalReportCommand): ProvisionalReport =>
  Option.match(Option.fromNullOr(command.setup), {
    onNone: () => runsPhaseOf(command),
    onSome: (next) => setupPhaseOf(command, next),
  })

const decide = (command: ProvisionalReportCommand): Result.Result<ProvisionalReport, never> =>
  Result.succeed(
    Option.match(Option.fromNullOr(command.abort), {
      onNone: () => inProgressOf(command),
      onSome: (abort): ProvisionalReport =>
        ProvisionalAborted.make({ report: reportOf(command, abortedOutcomeOf(abort.code, abort.reason)) }),
    }),
  )

export const provisionalReport = Workflow.make({
  command: ProvisionalReportCommand,
  decision: ProvisionalReport,
  error: S.Never,
  decide,
})
