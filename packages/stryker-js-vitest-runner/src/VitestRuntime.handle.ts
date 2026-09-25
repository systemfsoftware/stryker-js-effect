import type { RunnerTestFile, RunnerTestSuite } from 'vitest'
import type { Vitest } from 'vitest/node'

import { Handle } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { type StrykerNamespace, type TestRunnerPhase } from './VitestRunner.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-vitest-runner/VitestRuntime')
export type TypeId = typeof TypeId

const VitestRuntime = Handle.make<
  { readonly projectRoot: string; readonly localSetupFile: string; readonly mutantBail: number },
  Vitest
>()(TypeId)

export type VitestRuntime = Handle.Of<typeof VitestRuntime>

export const isVitestRuntime = VitestRuntime.is

const driverOf = (self: VitestRuntime): Vitest => VitestRuntime.slot(self)

export type HarnessKey = 'hitLimit' | 'mutantActivation' | 'activeMutant'

export type HarnessValue = number | string | undefined

interface RunFilterInput {
  readonly related: string[] | undefined
  readonly testNamePattern: RegExp | undefined
}

const isErrorWithCode = (value: unknown): value is { readonly code: string } =>
  typeof Reflect.get(Object(value), 'code') === 'string'

const errorCodeOf = <A>(cause: A): Option.Option<string> =>
  Option.map(Option.liftPredicate(cause, isErrorWithCode), (value) => value.code)

const failRuntime = (phase: TestRunnerPhase) => <E>(cause: E) =>
  new TestRunner.TestRunnerFailed({
    runnerName: 'vitest',
    phase,
    cause: `${
      Option.getOrElse(
        Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text),
        () => '',
      )
    }${Option.match(errorCodeOf(cause), { onNone: () => '', onSome: (code) => ` (code: ${code})` })}`,
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
  driverOf(self).provide('globalNamespace', namespace)
  disableScreenshotFailures(Reflect.get(driverOf(self).config, 'browser'))
  driverOf(self).projects.forEach((project) => {
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
  readonly mutantBail: number
}): VitestRuntime =>
  withApplicationSetup(
    VitestRuntime.make(
      { projectRoot: options.projectRoot, localSetupFile: options.localSetupFile, mutantBail: options.mutantBail },
      options.driver,
    ),
    options.namespace,
  )

const DRY_RUN_REPORTS_EVERY_FAILURE = 0

const workerBailFor = (self: VitestRuntime, mode: 'dry-run' | 'mutant'): number =>
  mode === 'dry-run' ? DRY_RUN_REPORTS_EVERY_FAILURE : self.mutantBail

export const setMode: {
  (mode: 'dry-run' | 'mutant'): (self: VitestRuntime) => void
  (self: VitestRuntime, mode: 'dry-run' | 'mutant'): void
} = dual(2, (self: VitestRuntime, mode: 'dry-run' | 'mutant'): void => {
  const driver = driverOf(self)
  const bail = workerBailFor(self, mode)
  driver.projects.forEach((project) => {
    project.config.bail = bail
  })
  driver.provide('mode', mode)
})

export const provideValue: {
  (key: HarnessKey, value: HarnessValue): (self: VitestRuntime) => void
  (self: VitestRuntime, key: HarnessKey, value: HarnessValue): void
} = dual(3, (self: VitestRuntime, key: HarnessKey, value: HarnessValue): void =>
  Match.value(key).pipe(
    Match.when('hitLimit', () => {
      driverOf(self).provide(
        'hitLimit',
        Option.getOrUndefined(Option.filter(Option.fromNullishOr(value), Predicate.isNumber)),
      )
    }),
    Match.when('mutantActivation', () => {
      const activation = Option.liftPredicate(
        value,
        (candidate): candidate is 'runtime' | 'static' => candidate === 'runtime' || candidate === 'static',
      )
      Option.map(activation, (candidate) => driverOf(self).provide('mutantActivation', candidate))
    }),
    Match.orElse(() => {
      Option.map(Option.liftPredicate(value, Predicate.isString), (candidate) =>
        driverOf(self).provide('activeMutant', candidate))
    }),
  ))

export const applyRunFilter: {
  (filter: RunFilterInput): (self: VitestRuntime) => Effect.Effect<void>
  (self: VitestRuntime, filter: RunFilterInput): Effect.Effect<void>
} = dual(2, (self: VitestRuntime, filter: RunFilterInput): Effect.Effect<void> =>
  Effect.sync(() => {
    driverOf(self).config.related = filter.related
    driverOf(self).projects.forEach((project) => {
      project.config.testNamePattern = filter.testNamePattern
    })
  }))

export const start: {
  (testFiles: string[] | undefined): (self: VitestRuntime) => Effect.Effect<void, TestRunner.TestRunnerFailed>
  (self: VitestRuntime, testFiles: string[] | undefined): Effect.Effect<void, TestRunner.TestRunnerFailed>
} = dual(2, (self: VitestRuntime, testFiles: string[] | undefined) =>
  Effect.tryPromise({
    try: () => driverOf(self).start(testFiles),
    catch: (cause) => failRuntime('dryRun')(cause),
  }))

export const files = (self: VitestRuntime): readonly RunnerTestFile[] => driverOf(self).state.getFiles()

export const clearFiles = (self: VitestRuntime): void => {
  const driver = driverOf(self)
  propertyOf(driver, 'state').pipe(
    Option.flatMap((state) => propertyOf(state, 'filesMap')),
    Option.match({ onNone: () => undefined, onSome: (filesMap) => clearFilesMap(filesMap) }),
  )
}

export const hasExternalErrors = (self: VitestRuntime): boolean => {
  const driver = driverOf(self)
  return errorsSetOf(driver).pipe(Option.flatMap(entryCountOf), Option.exists((count) => count > 0))
}

export const externalErrorText = (self: VitestRuntime): string => {
  const driver = driverOf(self)
  return Option.match(errorsSetOf(driver), {
    onNone: () => '',
    onSome: (errorsSet) =>
      Predicate.isIterable(errorsSet)
        ? [...errorsSet].map((error) =>
          Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(error), (rendered) => rendered.text), () => '')
        ).join('\n')
        : '',
  })
}

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
    driverOf(self).onClose(() =>
      Effect.runPromiseWith(cleanup)(
        fs.remove(self.localSetupFile, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined)),
      )
    )
    yield* Effect.tryPromise({
      try: () => driverOf(self).close(),
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
