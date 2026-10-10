import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRun, BenchRunInvalid, BenchRunKey, BenchRunMeasured } from './bench-run.schema.js'

const DecodeWireLine = S.decodeResult(RunEvent.RunEventWireLine)

export class ReadBenchRunCommand extends S.TaggedClass<ReadBenchRunCommand>()('ReadBenchRunCommand', {
  key: BenchRunKey,
  lines: S.Array(S.String),
  exitCode: S.Int,
  workloadDigest: S.String,
  wallMs: Report.NonNegativeFinite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isBlank = (line: string): boolean => line.trim().length === 0

const isTested = S.is(RunEvent.RunMutantTestedEvent)
const isVerdict = S.is(RunEvent.VerdictReached)

const isTestedEvent = (event: RunEvent.RunEvent): event is RunEvent.RunMutantTestedEvent => isTested(event)

const isVerdictEvent = (event: RunEvent.RunEvent): event is RunEvent.VerdictReached => isVerdict(event)

const undecodable = (command: ReadBenchRunCommand, lineNumber: number, reason: string): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: command.key,
    reason: `stdout line ${lineNumber} decodes under no CLI contract event: ${reason}`,
    lineNumber,
  })

const violated = (command: ReadBenchRunCommand, reason: string): BenchRunInvalid =>
  BenchRunInvalid.make({ key: command.key, reason, lineNumber: null })

const decodeEvents = (command: ReadBenchRunCommand): Result.Result<ReadonlyArray<RunEvent.RunEvent>, BenchRunInvalid> =>
  command.lines.reduce<Result.Result<ReadonlyArray<RunEvent.RunEvent>, BenchRunInvalid>>(
    (accumulated, line, index) =>
      Result.flatMap(accumulated, (events) =>
        Boolean.match(isBlank(line), {
          onTrue: () => Result.succeed(events),
          onFalse: () =>
            Result.match(DecodeWireLine(line), {
              onFailure: (issue) => Result.fail(undecodable(command, index + 1, issue.message)),
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

const measuredOrInvalid = (command: ReadBenchRunCommand, events: ReadonlyArray<RunEvent.RunEvent>): BenchRun => {
  const verdicts = Arr.filter(events, isVerdictEvent)
  return Boolean.match(Arr.length(verdicts) === 1, {
    onFalse: () => violated(command, `the stream must hold exactly one verdict event, found ${Arr.length(verdicts)}`),
    onTrue: () =>
      Option.match(Option.flatMap(Arr.head(verdicts), (verdict) => Option.fromNullishOr(verdict.phaseDurations)), {
        onNone: () => violated(command, 'the verdict event carries no phase durations'),
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
            exitCode: command.exitCode,
          }),
      }),
  })
}

const decide = (command: ReadBenchRunCommand): Result.Result<BenchRun, never> =>
  Result.match(decodeEvents(command), {
    onFailure: (failure) => Result.succeed(failure),
    onSuccess: (events) => Result.succeed(measuredOrInvalid(command, events)),
  })

export const readBenchRun = Workflow.make({
  command: ReadBenchRunCommand,
  decision: BenchRun,
  error: S.Never,
  decide,
})
