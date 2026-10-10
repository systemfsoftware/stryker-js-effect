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
  type PhaseTime,
  RunExit,
  WorkloadDigest,
} from './bench-run.schema.js'

const DecodeWireLine = S.decodeResult(RunEvent.RunEventWireLine)

export class ReadBenchRunCommand extends S.TaggedClass<ReadBenchRunCommand>()('ReadBenchRunCommand', {
  key: BenchRunKey,
  lines: S.Array(S.String),
  arrivalsMs: S.Array(Report.NonNegativeFinite),
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

const isPhaseEvent = S.is(RunEvent.PhaseEntered)

interface Arrived {
  readonly event: RunEvent.RunEvent
  readonly arrivalMs: number
}

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
): Result.Result<ReadonlyArray<Arrived>, BenchRunInvalid> =>
  Arr.zip(command.lines, command.arrivalsMs).reduce<Result.Result<ReadonlyArray<Arrived>, BenchRunInvalid>>(
    (accumulated, [line, arrivalMs], index) =>
      Result.flatMap(accumulated, (arrived) =>
        Boolean.match(isBlank(line), {
          onTrue: () => Result.succeed(arrived),
          onFalse: () =>
            Result.match(DecodeWireLine(line), {
              onFailure: (issue) => Result.fail(undecodable(command, exitCode, index + 1, issue.message)),
              onSuccess: (event) => Result.succeed([...arrived, { event, arrivalMs }]),
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

const isMark = (entry: Arrived): boolean => Boolean.or(isPhaseEvent(entry.event), isVerdictEvent(entry.event))

const phaseTimesOf = (arrived: ReadonlyArray<Arrived>): ReadonlyArray<PhaseTime> => {
  const marks = Arr.filter(arrived, isMark)
  return Arr.getSomes(Arr.map(Arr.zip(marks, Arr.drop(marks, 1)), ([mark, next]) =>
    Option.map(
      Option.liftPredicate(mark.event, isPhaseEvent),
      (entered): PhaseTime => ({ phase: entered.phase, startMs: mark.arrivalMs, endMs: next.arrivalMs }),
    )))
}

const arrivalsMismatch = (command: ReadBenchRunCommand): boolean =>
  Boolean.or(
    Arr.length(command.lines) !== Arr.length(command.arrivalsMs),
    Arr.some(Arr.zip(command.arrivalsMs, Arr.drop(command.arrivalsMs, 1)), ([earlier, later]) => later < earlier),
  )

const measuredOrInvalid = (
  command: ReadBenchRunCommand,
  exitCode: number,
  arrived: ReadonlyArray<Arrived>,
): BenchRun => {
  const events = Arr.map(arrived, (entry) => entry.event)
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
            phaseTimes: phaseTimesOf(arrived),
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
  Boolean.match(arrivalsMismatch(command), {
    onTrue: (): BenchRun =>
      violated(
        command,
        exitCode,
        `the run has ${Arr.length(command.lines)} stream lines but ${
          Arr.length(command.arrivalsMs)
        } arrival times, or its arrival times go backwards`,
      ),
    onFalse: () =>
      Result.match(decodeEvents(command, exitCode), {
        onFailure: (failure): BenchRun => failure,
        onSuccess: (arrived) => measuredOrInvalid(command, exitCode, arrived),
      }),
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
