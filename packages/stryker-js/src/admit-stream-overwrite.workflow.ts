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

type Mode =
  | 'value'
  | 'valueOrEnd'
  | 'keyOrEnd'
  | 'key'
  | 'colon'
  | 'afterValue'
  | 'string'
  | 'escape'
  | 'unicode'
  | 'literal'
  | 'minus'
  | 'zero'
  | 'integer'
  | 'dot'
  | 'fraction'
  | 'exponent'
  | 'exponentSign'
  | 'exponentDigits'
  | 'closed'
  | 'invalid'

interface Scan {
  readonly mode: Mode
  readonly open: string
  readonly key: boolean
  readonly pending: string
}

const START: Scan = { mode: 'value', open: '', key: false, pending: '' }

const isSpace = (char: string) => ' \t\n\r'.includes(char)
const isDigit = (char: string) => '0123456789'.includes(char)
const isOneToNine = (char: string) => '123456789'.includes(char)
const isHex = (char: string) => '0123456789abcdefABCDEF'.includes(char)
const isExponent = (char: string) => 'eE'.includes(char)
const isEscaped = (char: string) => '"\\/bfnrt'.includes(char)
const isControl = (char: string) => char < ' '

const to = (scan: Scan, mode: Mode): Scan => ({ ...scan, mode })

const afterValueOf = (scan: Scan): Scan =>
  Boolean.match(scan.open.length === 0, {
    onTrue: () => to(scan, 'closed'),
    onFalse: () => to(scan, 'afterValue'),
  })

const opened = (scan: Scan, char: string): Scan =>
  Match.value(char).pipe(
    Match.when('{', (): Scan => ({ ...scan, mode: 'keyOrEnd', open: `${scan.open}{` })),
    Match.orElse((): Scan => ({ ...scan, mode: 'valueOrEnd', open: `${scan.open}[` })),
  )

const closerOf = (open: string) =>
  Match.value(open.slice(-1)).pipe(
    Match.when('{', () => '}'),
    Match.orElse(() => ']'),
  )

const closedBy = (scan: Scan, char: string): Scan =>
  Boolean.match(char === closerOf(scan.open), {
    onTrue: () => afterValueOf({ ...scan, open: scan.open.slice(0, -1) }),
    onFalse: () => to(scan, 'invalid'),
  })

const literalOf = (scan: Scan, rest: string): Scan => ({ ...scan, mode: 'literal', pending: rest })

const valueStart = (scan: Scan, char: string): Scan =>
  Match.value(char).pipe(
    Match.when('"', (): Scan => ({ ...scan, mode: 'string', key: false })),
    Match.whenOr('{', '[', () => opened(scan, char)),
    Match.when('-', () => to(scan, 'minus')),
    Match.when('0', () => to(scan, 'zero')),
    Match.when(isOneToNine, () => to(scan, 'integer')),
    Match.when('t', () => literalOf(scan, 'rue')),
    Match.when('f', () => literalOf(scan, 'alse')),
    Match.when('n', () => literalOf(scan, 'ull')),
    Match.when(isSpace, () => scan),
    Match.orElse(() => to(scan, 'invalid')),
  )

const keyStart = (scan: Scan, char: string): Scan =>
  Match.value(char).pipe(
    Match.when('"', (): Scan => ({ ...scan, mode: 'string', key: true })),
    Match.when(isSpace, () => scan),
    Match.orElse(() => to(scan, 'invalid')),
  )

const numberEndedBy = (scan: Scan, char: string): Scan => stepOf(afterValueOf(scan), char)

const steps: Record<Mode, (scan: Scan, char: string) => Scan> = {
  value: valueStart,
  valueOrEnd: (scan, char) =>
    Match.value(char).pipe(
      Match.when(']', () => closedBy(scan, char)),
      Match.orElse(() => valueStart(scan, char)),
    ),
  keyOrEnd: (scan, char) =>
    Match.value(char).pipe(
      Match.when('}', () => closedBy(scan, char)),
      Match.orElse(() => keyStart(scan, char)),
    ),
  key: keyStart,
  colon: (scan, char) =>
    Match.value(char).pipe(
      Match.when(':', () => to(scan, 'value')),
      Match.when(isSpace, () => scan),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  afterValue: (scan, char) =>
    Match.value(char).pipe(
      Match.when(',', () =>
        Boolean.match(closerOf(scan.open) === '}', {
          onTrue: () => to(scan, 'key'),
          onFalse: () => to(scan, 'value'),
        })),
      Match.whenOr('}', ']', () => closedBy(scan, char)),
      Match.when(isSpace, () => scan),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  string: (scan, char) =>
    Match.value(char).pipe(
      Match.when('\\', () => to(scan, 'escape')),
      Match.when('"', () =>
        Boolean.match(scan.key, {
          onTrue: () => to(scan, 'colon'),
          onFalse: () => afterValueOf(scan),
        })),
      Match.when(isControl, () => to(scan, 'invalid')),
      Match.orElse(() => scan),
    ),
  escape: (scan, char) =>
    Match.value(char).pipe(
      Match.when('u', (): Scan => ({ ...scan, mode: 'unicode', pending: 'xxxx' })),
      Match.when(isEscaped, () => to(scan, 'string')),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  unicode: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isHex, (): Scan => ({
        ...scan,
        mode: Boolean.match(scan.pending.length === 1, { onTrue: () => 'string', onFalse: () => 'unicode' }),
        pending: scan.pending.slice(1),
      })),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  literal: (scan, char) =>
    Boolean.match(scan.pending.startsWith(char), {
      onTrue: () =>
        Boolean.match(scan.pending.length === 1, {
          onTrue: () => afterValueOf({ ...scan, pending: '' }),
          onFalse: () => literalOf(scan, scan.pending.slice(1)),
        }),
      onFalse: () => to(scan, 'invalid'),
    }),
  minus: (scan, char) =>
    Match.value(char).pipe(
      Match.when('0', () => to(scan, 'zero')),
      Match.when(isOneToNine, () => to(scan, 'integer')),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  zero: (scan, char) =>
    Match.value(char).pipe(
      Match.when('.', () => to(scan, 'dot')),
      Match.when(isExponent, () => to(scan, 'exponent')),
      Match.orElse(() => numberEndedBy(scan, char)),
    ),
  integer: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isDigit, () => scan),
      Match.when('.', () => to(scan, 'dot')),
      Match.when(isExponent, () => to(scan, 'exponent')),
      Match.orElse(() => numberEndedBy(scan, char)),
    ),
  dot: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isDigit, () => to(scan, 'fraction')),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  fraction: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isDigit, () => scan),
      Match.when(isExponent, () => to(scan, 'exponent')),
      Match.orElse(() => numberEndedBy(scan, char)),
    ),
  exponent: (scan, char) =>
    Match.value(char).pipe(
      Match.whenOr('+', '-', () => to(scan, 'exponentSign')),
      Match.when(isDigit, () => to(scan, 'exponentDigits')),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  exponentSign: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isDigit, () => to(scan, 'exponentDigits')),
      Match.orElse(() => to(scan, 'invalid')),
    ),
  exponentDigits: (scan, char) =>
    Match.value(char).pipe(
      Match.when(isDigit, () => scan),
      Match.orElse(() => numberEndedBy(scan, char)),
    ),
  closed: (scan) => scan,
  invalid: (scan) => scan,
}

const stepOf = (scan: Scan, char: string): Scan => steps[scan.mode](scan, char)

const isUnclosedJsonStart = (text: string) =>
  !['closed', 'invalid'].includes(Arr.reduce(text.split(''), START, stepOf).mode)

const isTornRecord = (command: StreamOverwriteCommand) =>
  Boolean.every([
    command.wholeFileRead,
    command.leadingText.length > 0,
    !command.leadingText.includes('\n'),
    isUnclosedJsonStart(command.leadingText),
    RunEventRecordOpening.literals.some(sharesAPrefix(command.leadingText)),
  ])

export class StreamOverwriteCommand
  extends S.TaggedClass<StreamOverwriteCommand, { readonly brand: unique symbol }>()('StreamOverwriteCommand', {
    file: S.String,
    regularFile: S.Boolean,
    empty: S.Boolean,
    wholeFileRead: S.Boolean,
    leadingText: S.String,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class OverwriteAllowed
  extends S.TaggedClass<OverwriteAllowed, { readonly brand: unique symbol }>()('OverwriteAllowed', {
    file: S.String,
  })
{
  readonly [StreamOverwriteTypeId] = StreamOverwriteTypeId
}

export class OverwriteRefused
  extends S.TaggedClass<OverwriteRefused, { readonly brand: unique symbol }>()('OverwriteRefused', {
    file: S.String,
    reason: S.String,
  })
{
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
