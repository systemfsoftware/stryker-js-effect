import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BenchRun,
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  RunExit,
  WorkloadDigest,
} from './bench-run.schema.js'

const DecodeWireLine = S.decodeResult(RunEvent.RunEventWireLine)

export class ReadBenchRunCommand extends S.TaggedClass<ReadBenchRunCommand>()('ReadBenchRunCommand', {
  key: BenchRunKey,
  lines: S.Array(S.String),
  exit: RunExit,
  workloadDigest: WorkloadDigest,
  stderrTail: S.String,
  wallMs: Report.NonNegativeFinite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isBlank = (line: string): boolean => line.trim().length === 0

const isTestedEvent = S.is(RunEvent.RunMutantTestedEvent)

const isVerdictEvent = S.is(RunEvent.VerdictReached)

const undecodable = (
  command: ReadBenchRunCommand,
  exitCode: number,
  lineNumber: number,
  reason: string,
): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: command.key,
    code: 'stream-undecodable',
    reason: `stdout line ${lineNumber} decodes under no CLI contract event: ${reason}`,
    lineNumber,
    exitCode,
    stderrTail: command.stderrTail,
  })

const violated = (command: ReadBenchRunCommand, exitCode: number, reason: string): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: command.key,
    code: 'stream-invalid',
    reason,
    lineNumber: null,
    exitCode,
    stderrTail: command.stderrTail,
  })

const timedOut = (command: ReadBenchRunCommand, afterMs: number): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: command.key,
    code: 'timeout',
    reason: `the run did not finish within ${(afterMs / 60_000).toFixed(1)} min and was stopped`,
    lineNumber: null,
    exitCode: null,
    stderrTail: command.stderrTail,
  })

const decodeEvents = (
  command: ReadBenchRunCommand,
  exitCode: number,
): Result.Result<ReadonlyArray<RunEvent.RunEvent>, BenchRunInvalid> =>
  command.lines.reduce<Result.Result<ReadonlyArray<RunEvent.RunEvent>, BenchRunInvalid>>(
    (accumulated, line, index) =>
      Result.flatMap(accumulated, (events) =>
        Boolean.match(isBlank(line), {
          onTrue: () => Result.succeed(events),
          onFalse: () =>
            Result.match(DecodeWireLine(line), {
              onFailure: (issue) => Result.fail(undecodable(command, exitCode, index + 1, issue.message)),
              onSuccess: (event) => Result.succeed([...events, event]),
            }),
        })),
    Result.succeed([]),
  )

const testsExecutedOf = (events: ReadonlyArray<RunEvent.RunEvent>): number =>
  Arr.reduce(
    Arr.filter(events, isTestedEvent),
    0,
    (sum, tested) =>
      sum + Option.getOrElse(Option.map(Option.fromNullishOr(tested.cost), (cost) => cost.testsExecuted), () => 0),
  )

const measuredOrInvalid = (
  command: ReadBenchRunCommand,
  exitCode: number,
  events: ReadonlyArray<RunEvent.RunEvent>,
): BenchRun => {
  const verdicts = Arr.filter(events, isVerdictEvent)
  return Boolean.match(Arr.length(verdicts) === 1, {
    onFalse: () =>
      violated(command, exitCode, `the stream must hold exactly one verdict event, found ${Arr.length(verdicts)}`),
    onTrue: () =>
      Option.match(Option.flatMap(Arr.head(verdicts), (verdict) => Option.fromNullishOr(verdict.phaseDurations)), {
        onNone: () => violated(command, exitCode, 'the verdict event carries no phase durations'),
        onSome: (phaseDurations) =>
          BenchRunMeasured.make({
            key: command.key,
            phaseDurations,
            mutants: Option.getOrElse(
              Option.map(Arr.head(verdicts), (verdict) => verdict.counts.totalMutants),
              () => 0,
            ),
            testsExecuted: testsExecutedOf(events),
            workloadDigest: command.workloadDigest,
            wallMs: command.wallMs,
            exitCode,
          }),
      }),
  })
}

const exitedRun = (command: ReadBenchRunCommand, exitCode: number): BenchRun =>
  Result.match(decodeEvents(command, exitCode), {
    onFailure: (failure): BenchRun => failure,
    onSuccess: (events) => measuredOrInvalid(command, exitCode, events),
  })

const decide = (command: ReadBenchRunCommand): Result.Result<BenchRun, never> =>
  Result.succeed(
    Match.valueTags(command.exit, {
      exited: (exited) => exitedRun(command, exited.code),
      'timed-out': (expired): BenchRun => timedOut(command, expired.afterMs),
    }),
  )

export const readBenchRun = Workflow.make({
  command: ReadBenchRunCommand,
  decision: BenchRun,
  error: S.Never,
  decide,
})
