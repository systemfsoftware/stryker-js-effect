import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ConfigErrorDescriptionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ConfigErrorDescription')
type ConfigErrorDescriptionTypeId = typeof ConfigErrorDescriptionTypeId

export class DescribeConfigErrorCommand extends S.TaggedClass<DescribeConfigErrorCommand>()(
  'DescribeConfigErrorCommand',
  {
    message: S.String.pipe(S.optional),
    errors: S.Array(S.String).pipe(S.optional),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigErrorDescribed extends S.TaggedClass<ConfigErrorDescribed>()('ConfigErrorDescribed', {
  errors: S.Array(S.String),
  text: S.String,
}) {
  readonly [ConfigErrorDescriptionTypeId] = ConfigErrorDescriptionTypeId
}

export class ConfigErrorUnparsed extends S.TaggedClass<ConfigErrorUnparsed>()('ConfigErrorUnparsed', {
  errors: S.Array(S.String),
  text: S.String,
}) {
  readonly [ConfigErrorDescriptionTypeId] = ConfigErrorDescriptionTypeId
}

export type ConfigErrorDescriptionDecision = ConfigErrorDescribed | ConfigErrorUnparsed

const PATH_LINE = /^at\s+(\[[^\]]*\])$/
const PATH_SEGMENT = /\["([^"]*)"\]|\[(\d+)\]/g
const EXPECTED_PATTERN = /^Expected a string matching the RegExp (.+)$/
const EXPECTED_TYPE = /^Expected (.+)$/

const appendPathSegment = (path: string, segment: RegExpMatchArray): string =>
  Match.value(segment[2]).pipe(
    Match.when(undefined, () => appendKeySegment(path, Option.getOrElse(Option.fromUndefinedOr(segment[1]), () => ''))),
    Match.orElse((index) => `${path}[${index}]`),
  )

const appendKeySegment = (path: string, key: string): string =>
  Match.value(path.length > 0).pipe(
    Match.when(true, () => `${path}.${key}`),
    Match.orElse(() => `${path}${key}`),
  )

const dottedPath = (raw: string): string => Array.from(raw.matchAll(PATH_SEGMENT)).reduce(appendPathSegment, '')

const phraseExpectedType = (expectation: string): string =>
  Match.value(EXPECTED_TYPE.exec(expectation)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => `should be ${Option.getOrElse(Option.fromUndefinedOr(match[1]), () => '')}`,
    ),
    Match.orElse(() => expectation),
  )

const phrase = (expectation: string): string =>
  Match.value(EXPECTED_PATTERN.exec(expectation)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => `must match pattern "${Option.getOrElse(Option.fromUndefinedOr(match[1]), () => '')}"`,
    ),
    Match.orElse(() => phraseExpectedType(expectation)),
  )

interface ErrorDescriptionState {
  readonly messages: readonly string[]
  readonly expectation: string | undefined
}

const EMPTY_ERROR_DESCRIPTION_STATE: ErrorDescriptionState = {
  messages: [],
  expectation: undefined,
}

const isBlankLine = (line: string): boolean => line.length === 0

const startExpectation = (state: ErrorDescriptionState, line: string): ErrorDescriptionState =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => ({ messages: state.messages, expectation: line })),
    Match.orElse((pending) => ({ messages: [...state.messages, pending], expectation: line })),
  )

const completeExpectation = (
  state: ErrorDescriptionState,
  pathText: string,
  line: string,
): ErrorDescriptionState =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => startExpectation(state, line)),
    Match.orElse((pending) => ({
      messages: [...state.messages, `Config option "${dottedPath(pathText)}" ${phrase(pending)}.`],
      expectation: undefined,
    })),
  )

const applyErrorLine = (state: ErrorDescriptionState, line: string): ErrorDescriptionState =>
  Match.value(PATH_LINE.exec(line)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => completeExpectation(state, Option.getOrElse(Option.fromUndefinedOr(match[1]), () => ''), line),
    ),
    Match.orElse(() => startExpectation(state, line)),
  )

const advanceErrorDescription = (
  state: ErrorDescriptionState,
  rawLine: string,
): ErrorDescriptionState =>
  Match.value(rawLine.trim()).pipe(
    Match.when(isBlankLine, () => state),
    Match.orElse((line) => applyErrorLine(state, line)),
  )

const completedErrorMessages = (state: ErrorDescriptionState): readonly string[] =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => state.messages),
    Match.orElse((pending) => [...state.messages, pending]),
  )

const errorMessageOrFallback = (messages: readonly string[], fallback: string): readonly string[] =>
  Match.value(messages.length > 0).pipe(
    Match.when(true, () => [...messages]),
    Match.orElse(() => [fallback]),
  )

const messageErrorsOf = (message: string): readonly string[] => {
  const state = message
    .split('\n')
    .reduce(advanceErrorDescription, EMPTY_ERROR_DESCRIPTION_STATE)
  return completedErrorMessages(state)
}

const messageErrorsOrFallback = (messages: readonly string[], fallback: string): readonly string[] =>
  errorMessageOrFallback(messages, fallback)

const configErrorHeadline = (errors: readonly string[]): string =>
  Match.value(errors.length === 1).pipe(
    Match.when(true, () => 'Please correct this configuration error and try again.'),
    Match.orElse(() => 'Please correct these configuration errors and try again.'),
  )

const configErrorMessage = (errors: readonly string[]): string => `${configErrorHeadline(errors)} ${errors.join(' ')}`

const describedOf = (command: DescribeConfigErrorCommand): ConfigErrorDescriptionDecision =>
  Option.match(Option.fromUndefinedOr(command.errors), {
    onSome: (errors) => ConfigErrorDescribed.make({ errors, text: configErrorMessage(errors) }),
    onNone: () => unparsedOrDescribedOf(Option.getOrElse(Option.fromUndefinedOr(command.message), () => '')),
  })

const unparsedOrDescribedOf = (message: string): ConfigErrorDescriptionDecision => {
  const parsed = messageErrorsOf(message)
  return Boolean.match(parsed.length > 0, {
    onTrue: () => ConfigErrorDescribed.make({ errors: parsed, text: configErrorMessage(parsed) }),
    onFalse: () =>
      ConfigErrorUnparsed.make({
        errors: messageErrorsOrFallback(parsed, message),
        text: configErrorMessage(messageErrorsOrFallback(parsed, message)),
      }),
  })
}

export const describeConfigError = Workflow.make({
  command: DescribeConfigErrorCommand,
  decision: S.Union([ConfigErrorDescribed, ConfigErrorUnparsed]),
  error: S.Never,
  decide: (command: DescribeConfigErrorCommand) => Result.succeed(describedOf(command)),
})
