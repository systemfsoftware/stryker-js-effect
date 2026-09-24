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

export interface FixturePropsRejection {
  readonly reason: string
}

export type FixtureProps = Result.Result<ReadonlySet<string>, FixturePropsRejection>

const filterOutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const splitByComma = (source: string): ReadonlyArray<string> => {
  const parts: string[] = []
  const stack: string[] = []
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{' || character === '[') {
      stack.push(character === '{' ? '}' : ']')
      continue
    }
    if (character === stack.at(-1)) {
      stack.pop()
      continue
    }
    if (stack.length === 0 && character === ',') {
      const token = source.substring(start, index).trim()
      if (token.length > 0) {
        parts.push(token)
      }
      start = index + 1
    }
  }
  const lastToken = source.substring(start).trim()
  if (lastToken.length > 0) {
    parts.push(lastToken)
  }
  return parts
}

const ordinalOf = (position: number): string => {
  const units = position % 10
  const tens = position % 100
  if (units === 1 && tens !== 11) {
    return `${position}st`
  }
  if (units === 2 && tens !== 12) {
    return `${position}nd`
  }
  if (units === 3 && tens !== 13) {
    return `${position}rd`
  }
  return `${position}th`
}

export const usedFixtureProps = (source: string, fixturesIndex = 0): FixtureProps => {
  const withoutComments = filterOutComments(source)
  const lowered = ASYNC_WRAPPER.test(withoutComments)
    ? withoutComments.split(ASYNC_WRAPPER_SPLIT)[1] ?? withoutComments
    : withoutComments
  const signature = lowered.match(SIGNATURE)
  if (signature === null) {
    return Result.succeed(new Set<string>())
  }
  const parameters = splitByComma(signature[1] ?? '')
  if (parameters.length === 0) {
    return Result.succeed(new Set<string>())
  }
  const fixturesArgument = parameters[fixturesIndex]
  if (fixturesArgument === undefined || fixturesArgument.length === 0) {
    return Result.succeed(new Set<string>())
  }
  if (!(fixturesArgument[0] === '{' && fixturesArgument.endsWith('}'))) {
    return Result.fail({
      reason: `The ${
        ordinalOf(fixturesIndex + 1)
      } argument inside a fixture must use object destructuring pattern, e.g. ({ task } => {}). Instead, received "${fixturesArgument}".`,
    })
  }
  const names = splitByComma(fixturesArgument.slice(1, -1).replace(/\s/g, '')).map((name) =>
    name.replace(PROPERTY_STRIP, '')
  )
  const rest = names.at(-1)
  if (rest !== undefined && rest.startsWith('...')) {
    return Result.fail({
      reason: `Rest parameters are not supported in fixtures, received "${rest}".`,
    })
  }
  return Result.succeed(new Set<string>(names))
}
