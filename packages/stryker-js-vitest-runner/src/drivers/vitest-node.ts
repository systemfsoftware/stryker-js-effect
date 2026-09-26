import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import type { Vitest } from 'vitest/node'

import type { VitestTestRecord } from '../vitest-run-command.schema.js'

export type VitestValue = S.Schema.Type<typeof S.Unknown>

const isOpaqueRecord = <A = VitestValue, V = VitestValue>(value: A): value is A & Record<string, V> =>
  Predicate.isObject(value)

const propertyOf = <A = VitestValue, V = VitestValue>(value: A, key: string): Option.Option<V> =>
  Option.flatMap(Option.liftPredicate(value, isOpaqueRecord<A, V>), (record) => Option.fromNullishOr(record[key]))

const textFieldOf = <A>(value: A, key: string): string =>
  Option.getOrElse(Option.filter(propertyOf(value, key), Predicate.isString), () => '')

export const fileKeyOf = <A>(file: A): string => textFieldOf(file, 'projectName') + '-' + textFieldOf(file, 'name')

export const metaOf = <A>(file: A): VitestValue => Option.getOrUndefined(propertyOf<A, VitestValue>(file, 'meta'))

export const errorCodeOf = <A>(cause: A): Option.Option<string> =>
  Option.filter(propertyOf<A, VitestValue>(cause, 'code'), Predicate.isString)

export const browserConfigOf = <A>(config: A): Option.Option<object> =>
  Option.filter(
    Option.flatMap(
      Option.liftPredicate(config, isOpaqueRecord<A, VitestValue>),
      (record) => Option.fromNullishOr(record['browser']),
    ),
    Predicate.isObject,
  )

export const screenshotFailuresOff = (browser: object): void => {
  Reflect.set(browser, 'screenshotFailures', false)
}

export const setupFilesOf = <A>(config: A): readonly string[] =>
  Option.getOrElse(
    Option.map(
      Option.filter(propertyOf<A, VitestValue>(config, 'setupFiles'), Array.isArray),
      (files) => files.filter(Predicate.isString),
    ),
    () => [],
  )

export const setSetupFiles: {
  (files: readonly string[]): (config: object) => void
  (config: object, files: readonly string[]): void
} = dual(2, (config: object, files: readonly string[]): void => {
  Reflect.set(config, 'setupFiles', files)
})

const invokeMethod = (holder: object, name: string): void => {
  Option.match(Option.filter(propertyOf<object, VitestValue>(holder, name), Predicate.isFunction), {
    onNone: () => undefined,
    onSome: (method) => {
      Reflect.apply(method, holder, [])
    },
  })
}

const clearCollection = (collection: object): void => {
  Match.value(collection).pipe(
    Match.when(Match.instanceOf(Map), (map) => {
      map.clear()
    }),
    Match.orElse((value) => invokeMethod(value, 'clear')),
  )
}

const readableOf = <A>(value: Option.Option<A>): Option.Option<object> => Option.filter(value, Predicate.isObject)

export const clearVitestFiles = <A>(vitest: A): void => {
  Option.map(
    Option.flatMap(
      readableOf(propertyOf<A, VitestValue>(vitest, 'state')),
      (state) => readableOf(propertyOf<object, VitestValue>(state, 'filesMap')),
    ),
    clearCollection,
  )
}

export const errorCollectionOf = <A>(vitest: A): Option.Option<VitestValue> =>
  Option.flatMap(
    readableOf(propertyOf<A, VitestValue>(vitest, 'state')),
    (state) => propertyOf<object, VitestValue>(state, 'errorsSet'),
  )

const entryCountOf = <A>(collection: A): Option.Option<number> =>
  Match.value(collection).pipe(
    Match.when(Match.instanceOf(Set), (set) => Option.some(set.size)),
    Match.orElse((value) => Option.filter(propertyOf<A, VitestValue>(value, 'size'), Predicate.isNumber)),
  )

export const hasEntries = <A>(collection: A): boolean => Option.exists(entryCountOf(collection), (count) => count > 0)

export const iterableEntriesOf = <A>(collection: A): ReadonlyArray<VitestValue> =>
  Option.getOrElse(
    Option.map(Option.liftPredicate(collection, Predicate.isIterable), (iterable) => [...iterable]),
    () => [],
  )

export const onClose: {
  <E>(vitest: Vitest, cleanup: Effect.Effect<void, E>): void
  <E>(cleanup: Effect.Effect<void, E>): (vitest: Vitest) => void
} = dual(2, <E>(vitest: Vitest, cleanup: Effect.Effect<void, E>): void => {
  vitest.onClose(() => Effect.runPromise(cleanup))
})

const recordOption = <A = VitestValue>(value: A): Option.Option<Record<string, VitestValue>> =>
  Option.liftPredicate(value, isOpaqueRecord<A, VitestValue>)

const fieldOf = <A = VitestValue>(value: A, key: string): VitestValue =>
  Option.getOrUndefined(propertyOf<A, VitestValue>(value, key))

const stringFieldOf = <A = VitestValue>(value: A, key: string): Option.Option<string> =>
  Option.filter(propertyOf<A, VitestValue>(value, key), Predicate.isString)

const numberFieldOf = <A = VitestValue>(value: A, key: string): Option.Option<number> =>
  Option.filter(propertyOf<A, VitestValue>(value, key), Predicate.isNumber)

const firstErrorMessageOf = <A = VitestValue>(result: A): Option.Option<string> =>
  Option.flatMap(
    Option.flatMap(propertyOf<A, VitestValue>(result, 'errors'), (errors) =>
      Option.flatMap(Option.liftPredicate(errors, Array.isArray), (list) => Option.fromNullishOr(list[0]))),
    (first) =>
      stringFieldOf(first, 'message'),
  )

const suiteNamesOf = <A = VitestValue>(suite: A): readonly string[] =>
  Option.match(recordOption(suite), {
    onNone: (): readonly string[] => [],
    onSome: (record) => {
      const name = textFieldOf(record, 'name')
      const parents = suiteNamesOf(fieldOf(record, 'suite'))
      return name.length > 0 ? [...parents, name] : parents
    },
  })

const suiteErrorOf = <A = VitestValue>(suite: A): string | undefined =>
  Option.match(recordOption(suite), {
    onNone: (): string | undefined => undefined,
    onSome: (record) =>
      Option.match(firstErrorMessageOf(fieldOf(record, 'result')), {
        onNone: () => suiteErrorOf(fieldOf(record, 'suite')),
        onSome: (message) => message,
      }),
  })

export const testRecordOf = <A = VitestValue>(test: A): VitestTestRecord => ({
  name: textFieldOf(test, 'name'),
  fullTestName: Option.getOrUndefined(stringFieldOf(test, 'fullTestName')),
  suiteNames: suiteNamesOf(fieldOf(test, 'suite')),
  fileName: Option.getOrUndefined(stringFieldOf(fieldOf(test, 'file'), 'filepath')),
  mode: Option.getOrUndefined(stringFieldOf(test, 'mode')),
  state: Option.getOrUndefined(stringFieldOf(fieldOf(test, 'result'), 'state')),
  durationMs: Option.getOrUndefined(numberFieldOf(fieldOf(test, 'result'), 'duration')),
  errorMessage: Option.getOrUndefined(firstErrorMessageOf(fieldOf(test, 'result'))),
  suiteErrorMessage: suiteErrorOf(fieldOf(test, 'suite')),
})
