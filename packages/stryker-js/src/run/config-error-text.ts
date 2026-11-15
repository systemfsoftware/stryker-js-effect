import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

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

const configErrorHeadline = (errors: readonly string[]): string =>
  Match.value(errors.length === 1).pipe(
    Match.when(true, () => 'Please correct this configuration error and try again.'),
    Match.orElse(() => 'Please correct these configuration errors and try again.'),
  )

export const configErrorTextOf = (errors: readonly string[]): string =>
  `${configErrorHeadline(errors)} ${errors.join(' ')}`

export const configErrorsOf = (input: {
  readonly message?: string | undefined
  readonly errors?: readonly string[] | undefined
}): readonly string[] =>
  Option.getOrElse(
    Option.fromUndefinedOr(input.errors),
    () => {
      const message = Option.getOrElse(Option.fromUndefinedOr(input.message), () => '')
      return errorMessageOrFallback(messageErrorsOf(message), message)
    },
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const S = await import('effect/Schema')

  const errorsArb = S.String.pipe(S.Array, Arbitrary.schema)

  const issueArb = Arbitrary.schema(
    S.Struct({
      segment: S.String.check(S.isPattern(/^[a-z]{1,5}$/)),
      issue: S.String.check(S.isPattern(/^[a-z]{1,10}$/)),
    }),
  )

  const blankArb = Arbitrary.schema(S.String.check(S.isPattern(/^\s*$/)))

  it.prop(
    '∀es_Errors_≡GivenErrorsAreKept',
    { of: [errorsArb], subject: configErrorsOf },
    (subject, [errors]) => subject({ errors }).join('\u0000') === errors.join('\u0000'),
  )

  it.prop(
    '∀m_Message_≡NestedPathNamesEverySegmentInOrder',
    { of: [issueArb], subject: configErrorsOf },
    (subject, [{ segment, issue }]) => {
      const errors = subject({ message: `Expected ${issue}\nat ["${segment}"]` })
      return errors.length === 1 && errors.at(0) === `Config option "${segment}" should be ${issue}.`
    },
  )

  it.prop(
    '∀m_Blank_≡BlankMessageIsItsOwnError',
    { of: [blankArb], subject: configErrorsOf },
    (subject, [message]) => {
      const errors = subject({ message })
      return errors.length === 1 && errors.at(0) === message
    },
  )

  it.prop(
    '∀es_Errors_≡HeadlinedByCount',
    { of: [errorsArb], subject: configErrorTextOf },
    (subject, [errors]) => {
      const headline = errors.length === 1
        ? 'Please correct this configuration error and try again.'
        : 'Please correct these configuration errors and try again.'
      return subject(errors) === `${headline} ${errors.join(' ')}`
    },
  )
}
