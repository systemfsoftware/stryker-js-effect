import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const DecodeWireLine = S.decodeResult(RunEvent.RunEventWireLine)

export class DecodeStreamCommand extends S.TaggedClass<DecodeStreamCommand>()('DecodeStreamCommand', {
  lines: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const StreamDecodedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/StreamDecoded')
type StreamDecodedTypeId = typeof StreamDecodedTypeId

export class StreamDecoded extends S.TaggedClass<StreamDecoded>()('StreamDecoded', {
  events: S.Array(RunEvent.RunEvent),
}) {
  readonly [StreamDecodedTypeId] = StreamDecodedTypeId
}

export class StreamLineUndecodable extends S.TaggedError<StreamLineUndecodable>()('StreamLineUndecodable', {
  lineNumber: S.Int,
  line: S.String,
  reason: S.String,
}) {
  override get message(): string {
    return `stdout line ${this.lineNumber} decodes under no CLI contract event: ${this.reason}\n${this.line}`
  }
}

const isBlank = (line: string): boolean => line.trim().length === 0

interface NumberedLine {
  readonly number: number
  readonly line: string
}

const eventOf = (numbered: NumberedLine): Result.Result<Option.Option<RunEvent.RunEvent>, StreamLineUndecodable> =>
  Boolean.match(isBlank(numbered.line), {
    onTrue: () => Result.succeed(Option.none()),
    onFalse: () =>
      Result.match(DecodeWireLine(numbered.line), {
        onFailure: (issue) =>
          Result.fail(
            StreamLineUndecodable.make({ lineNumber: numbered.number, line: numbered.line, reason: issue.message }),
          ),
        onSuccess: (event) => Result.succeed(Option.some(event)),
      }),
  })

const decide = (command: DecodeStreamCommand): Result.Result<StreamDecoded, StreamLineUndecodable> =>
  Result.map(
    command.lines.reduce<Result.Result<ReadonlyArray<RunEvent.RunEvent>, StreamLineUndecodable>>(
      (accumulated, line, index) =>
        Result.flatMap(accumulated, (events) =>
          Result.map(eventOf({ number: index + 1, line }), (event) =>
            Option.match(event, {
              onNone: () =>
                events,
              onSome: (decoded) => [...events, decoded],
            }))),
      Result.succeed([]),
    ),
    (events) =>
      StreamDecoded.make({ events }),
  )

export const decodeStream = Workflow.make({
  command: DecodeStreamCommand,
  decision: StreamDecoded,
  error: StreamLineUndecodable,
  decide,
})
