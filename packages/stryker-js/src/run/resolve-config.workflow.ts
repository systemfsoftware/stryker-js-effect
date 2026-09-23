import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '../config/merge-config.js'

const LoadConfigDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/LoadConfigDecision')
type LoadConfigDecisionTypeId = typeof LoadConfigDecisionTypeId

export class ConfigFromFile extends S.TaggedClass<ConfigFromFile>()('ConfigFromFile', {
  options: StrykerOptionsSchema,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigFromDefaults extends S.TaggedClass<ConfigFromDefaults>()('ConfigFromDefaults', {
  options: StrykerOptionsSchema,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class LoadConfigRefused extends S.TaggedError<LoadConfigRefused>()('LoadConfigRefused', {
  message: S.String,
}) {}

export type LoadConfigDecision = ConfigFromFile | ConfigFromDefaults

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  cliOptions: S.Record(S.String, S.Unknown),
  fileOptions: S.optional(S.Record(S.String, S.Unknown)),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const PATH_LINE = /^at\s+(\[.*\])$/
const PATH_SEGMENT = /\["([^"]*)"\]|\[(\d+)\]/g
const EXPECTED_PATTERN = /^Expected a string matching the RegExp (.+)$/
const EXPECTED_TYPE = /^Expected (.+)$/

const appendPathSegment = (path: string, segment: RegExpMatchArray): string =>
  Match.value(segment[2]).pipe(
    Match.when(undefined, () => appendKeySegment(path, segment[1] ?? '')),
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
      (match) => `should be ${match[1] ?? ''}`,
    ),
    Match.orElse(() => expectation),
  )

const phrase = (expectation: string): string =>
  Match.value(EXPECTED_PATTERN.exec(expectation)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => `must match pattern "${match[1] ?? ''}"`,
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
      (match) => completeExpectation(state, match[1] ?? '', line),
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

const errorMessageOrFallback = (messages: readonly string[], fallback: string): string[] =>
  Match.value(messages.length > 0).pipe(
    Match.when(true, () => [...messages]),
    Match.orElse(() => [fallback]),
  )

export function describeErrors(error: S.SchemaError): string[] {
  const state = error.message
    .split('\n')
    .reduce(advanceErrorDescription, EMPTY_ERROR_DESCRIPTION_STATE)
  return errorMessageOrFallback(completedErrorMessages(state), error.message)
}

const configErrorHeadline = (errors: readonly string[]): string =>
  Match.value(errors.length === 1).pipe(
    Match.when(true, () => 'Please correct this configuration error and try again.'),
    Match.orElse(() => 'Please correct these configuration errors and try again.'),
  )

const configErrorMessage = (errors: readonly string[]): string => `${configErrorHeadline(errors)} ${errors.join(' ')}`

const decidedFromOf = (
  fileOptions: Record<string, unknown> | undefined,
  options: typeof StrykerOptionsSchema.Type,
) =>
  Match.value(fileOptions).pipe(
    Match.when(undefined, () => ConfigFromDefaults.make({ options })),
    Match.orElse(() => ConfigFromFile.make({ options })),
  )

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: LoadConfigRefused,
  decide: (command) =>
    Result.mapError(
      S.decodeUnknownResult(StrykerOptionsSchema)(
        mergeConfig(command.fileOptions ?? {}, command.cliOptions),
      ),
      (failure) => LoadConfigRefused.make({ message: failure.pipe(describeErrors, configErrorMessage) }),
    ).pipe(
      Result.map((options) => decidedFromOf(command.fileOptions, options)),
    ),
})
