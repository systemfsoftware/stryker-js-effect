import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import type { Position } from './Location.schema.js'
import { Mutant } from './Mutant.schema.js'
import type { MutantActivation, MutantStatus } from './Mutant.schema.js'

export { LocationSchema, PositionSchema } from './Location.schema.js'
export type { Location, Position } from './Location.schema.js'
export { Mutant } from './Mutant.schema.js'
export type { MutantActivation, MutantStatus } from './Mutant.schema.js'

export interface MutantCoverage {
  readonly perTest: Record<string, Record<string, number>>
  readonly static: Record<string, number>
}

export type CoverageData = Record<string, number>

export type CoveragePerTestId = Record<string, CoverageData>

export interface Coverage {
  readonly static: CoverageData
  readonly perTest: CoveragePerTestId
}

export interface RunOptions {
  readonly timeout: number
  readonly disableBail: boolean
}

export interface MutantRunOptions extends RunOptions {
  readonly testFilter?: readonly string[]
  readonly hitLimit?: number
  readonly activeMutant: Mutant
  readonly sandboxFileName: string
  readonly mutantActivation: MutantActivation
  readonly reloadEnvironment: boolean
}

export interface EarlyResultPlan {
  readonly plan: 'EarlyResult'
  readonly mutant: Mutant
}

export interface RunPlan {
  readonly plan: 'Run'
  readonly mutant: Mutant
  readonly runOptions: MutantRunOptions
  readonly netTime: number
}

export type TestPlan = EarlyResultPlan | RunPlan

export const isMutant = (value: unknown): value is Mutant => S.is(Mutant)(value)

export type MutantTestCoverage = Mutant & {
  readonly coveredBy: ReadonlyArray<string> | undefined
  readonly static: boolean | undefined
}

export type RunMutantResult = Mutant & {
  readonly status: MutantStatus
  readonly statusReason?: string | undefined
  readonly testsCompleted?: number | undefined
  readonly killedBy?: readonly string[] | undefined
  readonly coveredBy?: readonly string[] | undefined
  readonly static?: boolean | undefined
}
export const INSTRUMENTER_CONSTANTS = Object.freeze({
  NAMESPACE: '__stryker__' as const,
  MUTATION_COVERAGE_OBJECT: 'mutantCoverage' as const,
  ACTIVE_MUTANT: 'activeMutant' as const,
  CURRENT_TEST_ID: 'currentTestId' as const,
  HIT_COUNT: 'hitCount' as const,
  HIT_LIMIT: 'hitLimit' as const,
  ACTIVE_MUTANT_ENV_VARIABLE: '__STRYKER_ACTIVE_MUTANT__' as const,
})

export interface InstrumenterContext {
  activeMutant?: string
  currentTestId?: string
  mutantCoverage?: MutantCoverage
  hitCount?: number
  hitLimit?: number
}

export function normalizeFileName(fileName: string): string {
  return fileName.replace(/\\/g, '/')
}

export interface ErrnoException extends Error {
  code?: string
  errno?: number
  path?: string
  syscall?: string
}

const hasText = (value: unknown): value is string => Predicate.isString(value) && value.length > 0

const textIfNonEmpty = <A = unknown>(value: A): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.fromUndefinedOr(value), hasText))

function readFieldOf<A = unknown>(record: Record<string, A>, key: string): A | undefined {
  return record[key]
}

const hasFieldIn = <A = unknown>(value: object, key: string): value is Record<string, A> => key in value

const fieldOf = <A = unknown>(value: object, key: string): A | undefined => {
  if (!hasFieldIn<A>(value, key)) {
    return undefined
  }
  return readFieldOf(value, key)
}

const hasStringCode = (error: Error): boolean =>
  Match.value(fieldOf(error, 'code')).pipe(
    Match.when(Match.string, () => true),
    Match.orElse(() => false),
  )

export function isErrnoException(error: unknown): error is ErrnoException {
  return Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), hasStringCode),
    Match.orElse(() => false),
  )
}

const isEmptyNumber = (value: number): boolean =>
  Match.value(value).pipe(
    Match.when(0, () => true),
    Match.orElse(Number.isNaN),
  )

const isEmptyError = (error: unknown): error is undefined | null | '' | 0 | false =>
  Match.value(error).pipe(
    Match.when(Match.undefined, () => true),
    Match.when(Match.null, () => true),
    Match.when(Match.string, (text) => text.length === 0),
    Match.when(Match.number, isEmptyNumber),
    Match.when(Match.boolean, (value) => !value),
    Match.orElse(() => false),
  )
const formatErrnoException = (error: ErrnoException): string =>
  Match.value(error.stack).pipe(
    Match.when(hasText, (stack) => `${error.name}: ${error.code} (${error.syscall}) ${stack}`),
    Match.orElse(() => `${error.name}: ${error.code} (${error.syscall})`),
  )

const formatError = (error: Error): string =>
  Match.value(error.stack).pipe(
    Match.when(hasText, (stack) => `${error.name}: ${error.message}\n${stack}`),
    Match.orElse(() => `${error.name}: ${error.message}`),
  )

const isJsonPrimitive = (value: unknown): value is number | boolean | bigint =>
  Match.value(value).pipe(
    Match.when(Match.number, () => true),
    Match.when(Match.boolean, () => true),
    Match.when(Match.bigint, () => true),
    Match.orElse(() => false),
  )

const jsonText = <A = unknown>(error: A): string | undefined =>
  Result.getOrElse(
    Result.try({
      try: () => textIfNonEmpty(JSON.stringify(error)),
      catch: () => undefined,
    }),
    () => undefined,
  )

const isNonPlaceholderText = (text: string): boolean =>
  Match.value({ hasLength: text.length > 0, isPlaceholder: text === '[object Object]' }).pipe(
    Match.when({ hasLength: true, isPlaceholder: false }, () => true),
    Match.orElse(() => false),
  )

const isUsableText = (value: unknown): value is string =>
  Match.value(value).pipe(
    Match.when(Match.string, isNonPlaceholderText),
    Match.orElse(() => false),
  )

const usableText = <A = unknown>(value: A): string => (isUsableText(value) ? value : '')

const objectToStringText = (value: object): string =>
  Match.value(fieldOf(value, 'toString')).pipe(
    Match.when(Match.instanceOf(Function), (callable) =>
      Result.getOrElse(
        Result.try({
          try: () => usableText(Reflect.apply(callable, value, [])),
          catch: () => '',
        }),
        () => '',
      )),
    Match.orElse(() => ''),
  )

const isObjectType = (cause: unknown): cause is object => typeof cause === 'object'

const isNonNullObjectType = <A = unknown>(error: A): error is A & object => error !== null && isObjectType(error)

const toStringText = <A = unknown>(error: A): string => (isNonNullObjectType(error) ? objectToStringText(error) : '')

const stringifyRest = <A = unknown>(error: A): string => {
  const json = jsonText(error)
  return hasText(json) ? json : toStringText(error)
}

function primitiveJsonOf<A = unknown>(error: A): string | undefined {
  return isJsonPrimitive(error) ? JSON.stringify(error) : undefined
}

const stringifyNonError = <A = unknown>(error: A): string => typeof error === 'string' ? error : nonStringTextOf(error)

function nonStringTextOf<A = unknown>(error: A): string {
  return primitiveJsonOf(error) ?? stringifyRest(error)
}

const errorText = (error: Error): string =>
  Match.value(error).pipe(
    Match.when(isErrnoException, formatErrnoException),
    Match.orElse(() => formatError(error)),
  )

export function errorToString<A = unknown>(error: A): string {
  return Match.value(error).pipe(
    Match.when(isEmptyError, () => ''),
    Match.when(Match.instanceOf(Error), errorText),
    Match.orElse(() => stringifyNonError(error)),
  )
}

export const ERROR_CODES = Object.freeze({ NoSuchFileOrDirectory: 'ENOENT' as const })
export interface MutationRange {
  readonly start: Position
  readonly end: Position
}

export type MutateDescription = ReadonlyArray<MutationRange> | boolean

export interface FileDescription {
  readonly mutate: MutateDescription
}

export type FileDescriptions = Record<string, FileDescription>

export type MutantRunPlan = RunPlan

export type MutantEarlyResultPlan = EarlyResultPlan

export type MutantTestPlan = TestPlan

const errorNameOf = (value: object): string | undefined =>
  Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => textIfNonEmpty(error.name)),
    Match.orElse(() => undefined),
  )

const tagOf = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, '_tag'))).pipe(
    Match.when(hasText, (tag) => tag),
    Match.orElse(() => errorNameOf(value)),
  )

const textWithNested = (own: string | undefined, nested: string | undefined): string | undefined =>
  Match.value(own).pipe(
    Match.when(hasText, (text) => appendNested(text, nested)),
    Match.orElse(() => nested),
  )

const appendNested = (own: string, nested: string | undefined): string =>
  Match.value(nested).pipe(
    Match.when(hasText, (text) => `${own}: ${text}`),
    Match.orElse(() => own),
  )

const errorMessage = (error: Error): string | undefined =>
  Match.value(error.message.length > 0).pipe(
    Match.when(true, () => error.message),
    Match.orElse(() => tagOf(error)),
  )

const errorMessageOrTag = (value: object): string | undefined =>
  Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), errorMessage),
    Match.orElse(() => tagOf(value)),
  )

const messageText = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, 'message'))).pipe(
    Match.when(hasText, (message) => message),
    Match.orElse(() => errorMessageOrTag(value)),
  )

const ownCauseText = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, 'reason'))).pipe(
    Match.when(hasText, (reason) => reason),
    Match.orElse(() => messageText(value)),
  )

const isPastDepth = (depth: number): boolean => depth > 4

const isMissingCause = <A = unknown>(cause: A): boolean => cause === undefined || cause === null

export const causeText: {
  <A = unknown>(cause: A, depth: number): string | undefined
  <A = unknown>(depth: number): (cause: A) => string | undefined
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  <A = unknown>(cause: A, depth: number): string | undefined =>
    isPastDepth(depth) ? undefined : missingCauseTextOf(cause, depth),
)

function missingCauseTextOf<A = unknown>(cause: A, depth: number): string | undefined {
  return isMissingCause(cause) ? undefined : causeTextOfValue(cause, depth)
}

function causeTextOfValue<A = unknown>(cause: A, depth: number): string | undefined {
  return typeof cause === 'string' ? textIfNonEmpty(cause) : objectCauseTextOf(cause, depth)
}

function objectCauseTextOf<A = unknown>(cause: A, depth: number): string | undefined {
  return isObjectType(cause)
    ? textWithNested(ownCauseText(cause), causeText(fieldOf(cause, 'cause'), depth + 1))
    : undefined
}
