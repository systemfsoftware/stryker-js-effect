import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array as Arr, Boolean, String as Str } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { RunEventRecordOpening, StreamFileFirstLine } from './stream-file-head.schema.js'

const StreamOverwriteTypeId = Symbol.for('@systemfsoftware/stryker-js/StreamOverwriteDecision')
type StreamOverwriteTypeId = typeof StreamOverwriteTypeId

const startsWithRunEvent = (text: string) =>
  Option.isSome(S.decodeOption(StreamFileFirstLine)(Arr.headNonEmpty(Str.split(text, '\n')).trim()))

const sharesAPrefix = (text: string) => (opening: string) =>
  Boolean.some([opening.startsWith(text), text.startsWith(opening)])

interface Scan {
  readonly depth: number
  readonly inString: boolean
  readonly escaped: boolean
  readonly closed: boolean
}

const OPENED: Scan = { depth: 0, inString: false, escaped: false, closed: false }

const nestedBy = (scan: Scan, step: number): Scan => ({
  ...scan,
  depth: scan.depth + step,
  closed: scan.depth + step === 0,
})

const stringStep = (scan: Scan, char: string): Scan =>
  Match.value(char).pipe(
    Match.when('\\', (): Scan => ({ ...scan, escaped: true })),
    Match.when('"', (): Scan => ({ ...scan, inString: false })),
    Match.orElse(() => scan),
  )

const structureStep = (scan: Scan, char: string): Scan =>
  Match.value(char).pipe(
    Match.when('"', (): Scan => ({ ...scan, inString: true })),
    Match.whenOr('{', '[', () => nestedBy(scan, 1)),
    Match.whenOr('}', ']', () => nestedBy(scan, -1)),
    Match.orElse(() => scan),
  )

const scanStep = (scan: Scan, char: string): Scan =>
  Match.value(scan).pipe(
    Match.when({ closed: true }, () => scan),
    Match.when({ escaped: true }, (): Scan => ({ ...scan, escaped: false })),
    Match.when({ inString: true }, () => stringStep(scan, char)),
    Match.orElse(() => structureStep(scan, char)),
  )

const closesItsOutermostValue = (text: string) => Arr.reduce(text.split(''), OPENED, scanStep).closed

const isTornRecord = (command: StreamOverwriteCommand) =>
  Boolean.every([
    command.wholeFileRead,
    command.leadingText.length > 0,
    !command.leadingText.includes('\n'),
    !closesItsOutermostValue(command.leadingText),
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
