import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'

const propertyOf = <A = unknown>(row: A, key: string): A | undefined => {
  const isObj = Predicate.isObject(row)
  return Match.value(isObj).pipe(
    Match.when(true, () => Object.getOwnPropertyDescriptor(row, key)?.value),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )
}

const formatScalar = <A = unknown>(value: A): string =>
  Match.value(typeof value).pipe(
    Match.when('string', () => String(value)),
    Match.when('number', () => String(value)),
    Match.when('boolean', () => String(value)),
    Match.when('bigint', () => String(value)),
    Match.orElse(() => JSON.stringify(value)),
  )

const templateValue = <A = unknown>(row: A, key: string): string => {
  const value = propertyOf(row, key)
  return Match.value(value === undefined).pipe(
    Match.when(true, () => ''),
    Match.when(false, () => formatScalar(value)),
    Match.exhaustive,
  )
}

const replaceToken = <A = unknown>(token: string, next: () => A | undefined, index: () => number): string =>
  Match.value(token).pipe(
    Match.when('%%', () => '%'),
    Match.when('%i', () => String(parseInt(String(next()), 10))),
    Match.when('%f', () => String(Number.parseFloat(String(next())))),
    Match.when('%d', () => String(Number(next()))),
    Match.when('%j', () => JSON.stringify(next())),
    Match.when('%#', () => {
      next()
      return String(index())
    }),
    Match.orElse(() => {
      const value = next()
      const isObj = typeof value === 'object'
      return Match.value(isObj).pipe(
        Match.when(true, () => JSON.stringify(value)),
        Match.when(false, () => String(value)),
        Match.exhaustive,
      )
    }),
  )

export const formatEachName = <A = unknown>(template: string, row: A): string => {
  const values: ReadonlyArray<A> = Array.isArray(row) ? row : [row]
  let index = 0
  const next = (): A | undefined => {
    const value = values[index]
    index += 1
    return value
  }
  const currentIndex = (): number => index

  return template
    .replace(/%[%#d\difjs]/g, (token) => replaceToken(token, next, currentIndex))
    .replace(/\$\{([^}]+)\}/g, (_match, key: string) => templateValue(row, key))
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key: string) => templateValue(row, key))
}
