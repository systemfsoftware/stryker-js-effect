import type { RunnerTestFile, RunnerTestSuite } from 'vitest'
import type { Vitest } from 'vitest/node'

import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import * as Predicate from 'effect/Predicate'

import { type StrykerNamespace, type TestRunnerPhase } from './VitestRunner.schema.js'

const TypeId = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestRuntime')
type TypeId = typeof TypeId

const DriverId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestRuntime/driver')

export interface VitestRuntime extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly [DriverId]: Vitest
  readonly projectRoot: string
  readonly localSetupFile: string
}

export type HarnessKey = 'hitLimit' | 'mutantActivation' | 'activeMutant'

export type HarnessValue = number | string | undefined

interface RunFilterInput {
  readonly related: string[] | undefined
  readonly testNamePattern: RegExp | undefined
}

const failRuntime = (phase: TestRunnerPhase) => <E>(cause: E) =>
  new TestRunner.TestRunnerFailed({
    runnerName: 'vitest',
    phase,
    cause: Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

const disableScreenshotFailures = <A>(value: A) =>
  Option.map(Option.filter(Option.fromNullishOr(value), Predicate.isObject), (browser) => {
    Reflect.set(browser, 'screenshotFailures', false)
  })

const setupFilePathsOf = <A>(value: A) =>
  Option.getOrElse(
    Option.map(Option.liftPredicate(value, Array.isArray), (files) => files.filter(Predicate.isString)),
    () => [],
  )

const withApplicationSetup = (self: VitestRuntime, namespace: StrykerNamespace): VitestRuntime => {
  self[DriverId].provide('globalNamespace', namespace)
  disableScreenshotFailures(Reflect.get(self[DriverId].config, 'browser'))
  self[DriverId].projects.forEach((project) => {
    const setupFiles = setupFilePathsOf(Reflect.get(project.config, 'setupFiles'))
    Reflect.set(project.config, 'setupFiles', [self.localSetupFile, ...setupFiles])
    disableScreenshotFailures(Reflect.get(project.config, 'browser'))
  })
  return self
}

export const make = (options: {
  readonly driver: Vitest
  readonly projectRoot: string
  readonly localSetupFile: string
  readonly namespace: StrykerNamespace
}): VitestRuntime =>
  withApplicationSetup(
    {
      [TypeId]: TypeId,
      [DriverId]: options.driver,
      projectRoot: options.projectRoot,
      localSetupFile: options.localSetupFile,
      ...Prototype,
    },
    options.namespace,
  )

export const setMode: {
  (mode: 'dry-run' | 'mutant'): (self: VitestRuntime) => Vitest
  (self: VitestRuntime, mode: 'dry-run' | 'mutant'): Vitest
} = dual(2, (self: VitestRuntime, mode: 'dry-run' | 'mutant') => self[DriverId].provide('mode', mode))

export const provideValue: {
  (key: HarnessKey, value: HarnessValue): (self: VitestRuntime) => void
  (self: VitestRuntime, key: HarnessKey, value: HarnessValue): void
} = dual(3, (self: VitestRuntime, key: HarnessKey, value: HarnessValue): void =>
  Match.value(key).pipe(
    Match.when('hitLimit', () => {
      self[DriverId].provide(
        'hitLimit',
        Option.getOrUndefined(Option.filter(Option.fromNullishOr(value), Predicate.isNumber)),
      )
    }),
    Match.when('mutantActivation', () => {
      const activation = Option.liftPredicate(
        value,
        (candidate): candidate is 'runtime' | 'static' => candidate === 'runtime' || candidate === 'static',
      )
      Option.map(activation, (candidate) => self[DriverId].provide('mutantActivation', candidate))
    }),
    Match.orElse(() => {
      Option.map(Option.liftPredicate(value, Predicate.isString), (candidate) =>
        self[DriverId].provide('activeMutant', candidate))
    }),
  ))

export const applyRunFilter: {
  (filter: RunFilterInput): (self: VitestRuntime) => Effect.Effect<void>
  (self: VitestRuntime, filter: RunFilterInput): Effect.Effect<void>
} = dual(2, (self: VitestRuntime, filter: RunFilterInput): Effect.Effect<void> =>
  Effect.sync(() => {
    self[DriverId].config.related = filter.related
    self[DriverId].projects.forEach((project) => {
      project.config.testNamePattern = filter.testNamePattern
    })
  }))

export const start: {
  (testFiles: string[] | undefined): (self: VitestRuntime) => Effect.Effect<void, TestRunner.TestRunnerFailed>
  (self: VitestRuntime, testFiles: string[] | undefined): Effect.Effect<void, TestRunner.TestRunnerFailed>
} = dual(2, (self: VitestRuntime, testFiles: string[] | undefined) =>
  Effect.tryPromise({
    try: () => self[DriverId].start(testFiles),
    catch: (cause) => failRuntime('dryRun')(cause),
  }))

export const files = (self: VitestRuntime): readonly RunnerTestFile[] => self[DriverId].state.getFiles()

export const clearFiles = (self: VitestRuntime): void =>
  Option.match(
    Option.flatMap(propertyOf(self[DriverId], 'state'), (state) => propertyOf(state, 'filesMap')),
    { onNone: () => undefined, onSome: (filesMap) => clearFilesMap(filesMap) },
  )

export const hasExternalErrors = (self: VitestRuntime): boolean =>
  Option.exists(Option.flatMap(errorsSetOf(self[DriverId]), entryCountOf), (count) => count > 0)

export const externalErrorText = (self: VitestRuntime): string =>
  Option.match(errorsSetOf(self[DriverId]), {
    onNone: () => '',
    onSome: (errorsSet) =>
      Predicate.isIterable(errorsSet)
        ? [...errorsSet].map((error) =>
          Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(error), (rendered) => rendered.text), () => '')
        ).join('\n')
        : '',
  })

export const metaOf = <A>(file: A) => Option.getOrUndefined(propertyOf(file, 'meta'))

export const dedupeFilesByName = <A = unknown>(files: readonly A[]): Record<string, A> =>
  Object.fromEntries(files.map((file) => [stringField(file, 'projectName') + '-' + stringField(file, 'name'), file]))

export const isRunnerTestSuite = (value: unknown): value is RunnerTestSuite =>
  Predicate.isObject(value) && Array.isArray(value['tasks'])

export const reportAllKillersOf = (options: { readonly disableBail?: boolean }) => options.disableBail === true

export const close = (
  self: VitestRuntime,
): Effect.Effect<void, TestRunner.TestRunnerFailed, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const cleanup = Context.make(FileSystem.FileSystem, fs)
    self[DriverId].onClose(() =>
      Effect.runPromiseWith(cleanup)(
        fs.remove(self.localSetupFile, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined)),
      )
    )
    yield* Effect.tryPromise({
      try: () => self[DriverId].close(),
      catch: (cause) => failRuntime('dispose')(cause),
    })
  })

const isOpaqueRecord = <A = unknown, V = unknown>(value: A): value is A & Record<string, V> => Predicate.isObject(value)

const propertyOf = <A = unknown, V = unknown>(value: A, key: string): Option.Option<V> =>
  Option.flatMap(Option.liftPredicate(value, isOpaqueRecord<A, V>), (record) => Option.fromNullishOr(record[key]))

const stringField = <A = unknown>(value: A, key: string): string =>
  Option.getOrElse(Option.filter(propertyOf(value, key), Predicate.isString), () => '')

const vitestStateOf = <A = unknown>(vitest: A) => propertyOf(vitest, 'state')

const errorsSetOf = <A = unknown>(vitest: A) =>
  Option.flatMap(vitestStateOf(vitest), (state) => propertyOf(state, 'errorsSet'))

const invokeMethod = <A = unknown>(holder: A, name: string): void => {
  Option.match(Option.filter(propertyOf(holder, name), Predicate.isFunction), {
    onNone: () => undefined,
    onSome: (method) => {
      Reflect.apply(method, holder, [])
    },
  })
}

const clearFilesMap = <A>(filesMap: A): void => {
  Match.value(filesMap).pipe(
    Match.when(Match.instanceOf(Map), (map) => {
      map.clear()
    }),
    Match.orElse((value) => invokeMethod(value, 'clear')),
  )
}

const entryCountOf = <A = unknown>(collection: A) =>
  Match.value(collection).pipe(
    Match.when(Match.instanceOf(Set), (set) => Option.some(set.size)),
    Match.orElse((value) => Option.filter(propertyOf(value, 'size'), Predicate.isNumber)),
  )
