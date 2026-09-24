import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

/**
 * The destructured fixture names a fixture function or test body uses, ported
 * from Vitest 5.0.1's `getUsedProps` (dist/chunks/run.*.js): the first
 * parameter must be an object-destructuring pattern, comments are stripped
 * before parsing, esbuild-lowered `__async` wrappers are unwrapped, defaults
 * and renamed properties are dropped, and rest elements are rejected.
 *
 * This is a pure parser rather than a workflow: it has one outcome shape (a
 * name set) plus a parse rejection the caller aborts with, so it fails the
 * two-variant decision bar and lives beside the registry that consumes it.
 */

const ASYNC_WRAPPER = /__async\((?:this|null), (?:null|arguments|\[[_0-9, ]*\]), function\*/
const ASYNC_WRAPPER_SPLIT = /__async\((?:this|null),/
const SIGNATURE = /[^(]*\(([^)]*)/
const PROPERTY_STRIP = /:.*|=.*/g

const CLOSERS: Record<string, string> = { '{': '}', '[': ']' }

export interface FixturePropsRejection {
  readonly reason: string
}

export type FixtureProps = Result.Result<ReadonlySet<string>, FixturePropsRejection>

const filterOutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

interface CommaSplitState {
  readonly parts: ReadonlyArray<string>
  readonly stack: ReadonlyArray<string>
  readonly start: number
}

const closerOf = (character: string): string | undefined => CLOSERS[character]

const isCommaBoundary = (state: CommaSplitState, character: string): boolean =>
  state.stack.length === 0 && character === ','

const pushCloser = (state: CommaSplitState, character: string): CommaSplitState | undefined =>
  Option.match(Option.fromNullishOr(closerOf(character)), {
    onNone: () => undefined,
    onSome: (closer) => ({ ...state, stack: [...state.stack, closer] }),
  })

const popCloser = (state: CommaSplitState): CommaSplitState => ({ ...state, stack: state.stack.slice(0, -1) })

const closeStep = (state: CommaSplitState, character: string): CommaSplitState | undefined =>
  character === state.stack.at(-1) ? popCloser(state) : undefined

const pushToken = (state: CommaSplitState, source: string, end: number): CommaSplitState => {
  const token = source.substring(state.start, end).trim()
  return token.length > 0
    ? { parts: [...state.parts, token], stack: state.stack, start: end + 1 }
    : { ...state, start: end + 1 }
}

const commaStep = (state: CommaSplitState, source: string, end: number): CommaSplitState | undefined =>
  isCommaBoundary(state, source.charAt(end)) ? pushToken(state, source, end) : undefined

const firstDefined = (
  candidates: ReadonlyArray<CommaSplitState | undefined>,
): CommaSplitState | undefined => candidates.find((candidate) => candidate !== undefined)

const splitStep = (state: CommaSplitState, source: string, index: number): CommaSplitState =>
  firstDefined([
    pushCloser(state, source.charAt(index)),
    closeStep(state, source.charAt(index)),
    commaStep(state, source, index),
  ]) ?? state

const finalToken = (state: CommaSplitState, source: string): ReadonlyArray<string> => {
  const token = source.substring(state.start).trim()
  return token.length > 0 ? [...state.parts, token] : state.parts
}

const splitByComma = (source: string): ReadonlyArray<string> => {
  let state: CommaSplitState = { parts: [], stack: [], start: 0 }
  for (let index = 0; index < source.length; index += 1) {
    state = splitStep(state, source, index)
  }
  return finalToken(state, source)
}

const ORDINAL_SUFFIXES: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }

const ordinalSuffixOf = (units: number): string | undefined => ORDINAL_SUFFIXES[units]

const suffixOf = (units: number): string => Option.getOrElse(Option.fromNullishOr(ordinalSuffixOf(units)), () => 'th')

const isOrdinalUnit = (units: number, tens: number): boolean =>
  ordinalSuffixOf(units) !== undefined && tens !== 10 + units

const ordinalOf = (position: number): string =>
  Match.value(isOrdinalUnit(position % 10, position % 100)).pipe(
    Match.when(true, () => `${position}${suffixOf(position % 10)}`),
    Match.when(false, () => `${position}th`),
    Match.exhaustive,
  )

const emptyProps = (): FixtureProps => Result.succeed(new Set<string>())

const namesProps = (names: ReadonlyArray<string>): FixtureProps => Result.succeed(new Set<string>(names))

const splitPartOf = (source: string): string =>
  Option.getOrElse(Option.fromNullishOr(source.split(ASYNC_WRAPPER_SPLIT)[1]), () => source)

const withoutAsyncWrapper = (source: string): string =>
  Match.value(ASYNC_WRAPPER.test(source)).pipe(
    Match.when(true, () => splitPartOf(source)),
    Match.when(false, () => source),
    Match.exhaustive,
  )

const signatureParamsOf = (source: string): ReadonlyArray<string> =>
  Option.getOrElse(
    Option.map(
      Option.fromNullishOr(withoutAsyncWrapper(filterOutComments(source)).match(SIGNATURE)),
      (signature) => splitByComma(Option.getOrElse(Option.fromNullishOr(signature[1]), () => '')),
    ),
    () => [],
  )

const destructuringRejection = (fixturesIndex: number, argument: string): FixtureProps =>
  Result.fail({
    reason: `The ${
      ordinalOf(fixturesIndex + 1)
    } argument inside a fixture must use object destructuring pattern, e.g. ({ task } => {}). Instead, received "${argument}".`,
  })

const restRejection = (rest: string): FixtureProps =>
  Result.fail({
    reason: `Rest parameters are not supported in fixtures, received "${rest}".`,
  })

const isDestructured = (argument: string): boolean => argument.startsWith('{') && argument.endsWith('}')

const namesOf = (argument: string): ReadonlyArray<string> =>
  splitByComma(argument.slice(1, -1).replace(/\s/g, '')).map((name) => name.replace(PROPERTY_STRIP, ''))

const restParamProps = (names: ReadonlyArray<string>, rest: string): FixtureProps =>
  Match.value(rest.startsWith('...')).pipe(
    Match.when(true, () => restRejection(rest)),
    Match.when(false, () => namesProps(names)),
    Match.exhaustive,
  )

const namesPropsOf = (names: ReadonlyArray<string>): FixtureProps =>
  Option.match(Option.fromNullishOr(names.at(-1)), {
    onNone: () => namesProps(names),
    onSome: (rest) => restParamProps(names, rest),
  })

const nonEmptyPropsOf = (argument: string, fixturesIndex: number): FixtureProps =>
  Match.value(isDestructured(argument)).pipe(
    Match.when(false, () => destructuringRejection(fixturesIndex, argument)),
    Match.when(true, () => namesPropsOf(namesOf(argument))),
    Match.exhaustive,
  )

const argumentPropsOf = (argument: string, fixturesIndex: number): FixtureProps =>
  Match.value(argument.length > 0).pipe(
    Match.when(false, () => emptyProps()),
    Match.when(true, () => nonEmptyPropsOf(argument, fixturesIndex)),
    Match.exhaustive,
  )

const paramsPropsOf = (parameters: ReadonlyArray<string>, fixturesIndex: number): FixtureProps =>
  Option.match(Option.fromNullishOr(parameters[fixturesIndex]), {
    onNone: () => emptyProps(),
    onSome: (argument) => argumentPropsOf(argument, fixturesIndex),
  })

const fixturePropsOf = (source: string, fixturesIndex: number): FixtureProps =>
  paramsPropsOf(signatureParamsOf(source), fixturesIndex)

export const usedFixtureProps: {
  (fixturesIndex?: number): (source: string) => FixtureProps
  (source: string, fixturesIndex?: number): FixtureProps
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  (source: string, fixturesIndex?: number): FixtureProps =>
    fixturePropsOf(source, Option.getOrElse(Option.fromNullishOr(fixturesIndex), () => 0)),
)
