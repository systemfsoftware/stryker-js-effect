import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array as Arr, Boolean, String as Str } from 'effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { JsonLine, RunEventRecordOpening, StreamFileFirstLine } from './stream-file-head.schema.js'

const StreamOverwriteTypeId = Symbol.for('@systemfsoftware/stryker-js/StreamOverwriteDecision')
type StreamOverwriteTypeId = typeof StreamOverwriteTypeId

const startsWithRunEvent = (text: string) =>
  Option.isSome(S.decodeOption(StreamFileFirstLine)(Arr.headNonEmpty(Str.split(text, '\n')).trim()))

const sharesAPrefix = (text: string) => (opening: string) =>
  Boolean.some([opening.startsWith(text), text.startsWith(opening)])

const isTornRecord = (command: StreamOverwriteCommand) =>
  Boolean.every([
    command.wholeFileRead,
    command.leadingText.length > 0,
    !command.leadingText.includes('\n'),
    Option.isNone(S.decodeOption(JsonLine)(command.leadingText)),
    RunEventRecordOpening.literals.some(sharesAPrefix(command.leadingText)),
  ])

export class StreamOverwriteCommand extends S.TaggedClass<StreamOverwriteCommand>()('StreamOverwriteCommand', {
  file: S.String,
  regularFile: S.Boolean,
  empty: S.Boolean,
  wholeFileRead: S.Boolean,
  leadingText: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class OverwriteAllowed extends S.TaggedClass<OverwriteAllowed>()('OverwriteAllowed', {
  file: S.String,
}) {
  readonly [StreamOverwriteTypeId] = StreamOverwriteTypeId
}

export class OverwriteRefused extends S.TaggedClass<OverwriteRefused>()('OverwriteRefused', {
  file: S.String,
  reason: S.String,
}) {
  readonly [StreamOverwriteTypeId] = StreamOverwriteTypeId
}

export const StreamOverwriteDecision = S.Union([OverwriteAllowed, OverwriteRefused])
export type StreamOverwriteDecision = typeof StreamOverwriteDecision.Type

const REFUSAL = 'the file exists and does not start with a Stryker run event record, so the run will not overwrite it'

const overwritable = (command: StreamOverwriteCommand) =>
  [
    !command.regularFile,
    command.empty,
    startsWithRunEvent(command.leadingText),
    isTornRecord(command),
  ].some(
    (allowed) => allowed,
  )

export const admitStreamOverwrite = Workflow.make({
  command: StreamOverwriteCommand,
  decision: StreamOverwriteDecision,
  error: S.Never,
  decide: (command): Result.Result<StreamOverwriteDecision, never> =>
    Result.succeed(
      Boolean.match(overwritable(command), {
        onTrue: () => OverwriteAllowed.make({ file: command.file }),
        onFalse: () => OverwriteRefused.make({ file: command.file, reason: REFUSAL }),
      }),
    ),
})
