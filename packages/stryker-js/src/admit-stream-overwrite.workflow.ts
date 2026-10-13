import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const StreamOverwriteTypeId = Symbol.for('@systemfsoftware/stryker-js/StreamOverwriteDecision')
type StreamOverwriteTypeId = typeof StreamOverwriteTypeId

const StreamHeaderLine = S.fromJsonString(S.TaggedStruct('stream', {}))

const startsWithStreamHeader = (text: string) =>
  Option.isSome(S.decodeOption(StreamHeaderLine)(text.split('\n', 1).join('').trim()))

export class StreamOverwriteCommand extends S.TaggedClass<StreamOverwriteCommand>()('StreamOverwriteCommand', {
  file: S.String,
  regularFile: S.Boolean,
  leadingText: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    regularFile: 'stryker.stream_overwrite.regular_file',
  } as const
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

const REFUSAL = 'the file exists and does not start with a Stryker stream header, so the run will not overwrite it'

const overwritable = (command: StreamOverwriteCommand) =>
  [!command.regularFile, command.leadingText.length === 0, startsWithStreamHeader(command.leadingText)].some(
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
