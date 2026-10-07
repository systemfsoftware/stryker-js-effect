import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { RunnerTestFile, RunnerTestSuite } from 'vitest'
import type { Vitest } from 'vitest/node'

import { Handle } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import {
  browserConfigOf,
  clearVitestFiles,
  errorCodeOf,
  errorCollectionOf,
  fileKeyOf,
  globalTestInputsOf,
  hasEntries,
  iterableEntriesOf,
  metaOf as metaDriverOf,
  onClose,
  screenshotFailuresOff,
  setSetupFiles,
  setupFilesOf,
  testFileModulesOf as testFileModulesDriverOf,
  type VitestValue,
} from './drivers/vitest-node.js'
import { type StrykerNamespace, type TestRunnerPhase } from './VitestRunner.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-vitest-runner/VitestRuntime')
export type TypeId = typeof TypeId

export interface MutantRunStartedSignal {
  current: Option.Option<Effect.Effect<void>>
}

export const makeMutantRunStartedSignal = (): MutantRunStartedSignal => ({ current: Option.none() })

const VitestRuntime = Handle.make<
  {
    readonly projectRoot: string
    readonly localSetupFile: string
    readonly mutantBail: number
    readonly globalTestInputs: readonly string[]
    readonly mutantRunStarted: MutantRunStartedSignal
  },
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

const causeTextOf = <A>(cause: A): string =>
  Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => '')

export const failRuntime = (phase: TestRunnerPhase) => <E>(cause: E): TestRunner.TestRunnerFailed =>
  TestRunner.TestRunnerFailed.make({
    runnerName: 'vitest',
    phase,
    cause: [causeTextOf(cause), ...Option.toArray(Option.map(errorCodeOf(cause), (code) => `(code: ${code})`))]
      .filter((part) => part.length > 0)
      .join(' '),
  })

const withApplicationSetup = (self: VitestRuntime, namespace: StrykerNamespace): VitestRuntime => {
  const driver = driverOf(self)
  driver.provide('globalNamespace', namespace)
  Option.map(browserConfigOf(driver.config), screenshotFailuresOff)
  driver.projects.forEach((project) => {
    setSetupFiles(project.config, [self.localSetupFile, ...setupFilesOf(project.config)])
    Option.map(browserConfigOf(project.config), screenshotFailuresOff)
  })
  return self
}

const SERIAL_WORKER_COUNT = 1

const pinSerialWorkerCount = (self: VitestRuntime): VitestRuntime => {
  const driver = driverOf(self)
  driver.config.maxWorkers = SERIAL_WORKER_COUNT
  driver.projects.forEach((project) => {
    project.config.maxWorkers = SERIAL_WORKER_COUNT
  })
  return self
}

export const make = (options: {
  readonly driver: Vitest
  readonly projectRoot: string
  readonly localSetupFile: string
  readonly namespace: StrykerNamespace
  readonly mutantBail: number
  readonly mutantRunStarted: MutantRunStartedSignal
}): VitestRuntime =>
  pinSerialWorkerCount(
    withApplicationSetup(
      VitestRuntime.make(
        {
          projectRoot: options.projectRoot,
          localSetupFile: options.localSetupFile,
          mutantBail: options.mutantBail,
          globalTestInputs: globalTestInputsOf(options.driver, [options.localSetupFile]),
          mutantRunStarted: options.mutantRunStarted,
        },
        options.driver,
      ),
      options.namespace,
    ),
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
} = dual(
  2,
  Effect.fn(SpanTaxonomy.Spans.vitestRuntimeApplyRunFilter.name)(
    function*(self: VitestRuntime, filter: RunFilterInput) {
      yield* Effect.sync(() => {
        const driver = driverOf(self)
        driver.config.related = filter.related
        driver.projects.forEach((project) => {
          project.config.testNamePattern = filter.testNamePattern
        })
      })
    },
  ),
)

export const armMutantRunStarted: {
  (notify: Effect.Effect<void>): (self: VitestRuntime) => void
  (self: VitestRuntime, notify: Effect.Effect<void>): void
} = dual(2, (self: VitestRuntime, notify: Effect.Effect<void>): void => {
  self.mutantRunStarted.current = Option.some(notify)
})

export const clearMutantRunStarted = (self: VitestRuntime): void => {
  self.mutantRunStarted.current = Option.none()
}

export const notifyMutantRunStarted = (signal: MutantRunStartedSignal): void => {
  const pending = signal.current
  signal.current = Option.none()
  Option.map(pending, (notify) => Effect.runSync(notify))
}

export const start: {
  (testFiles: string[] | undefined): (self: VitestRuntime) => Effect.Effect<void, TestRunner.TestRunnerFailed>
  (self: VitestRuntime, testFiles: string[] | undefined): Effect.Effect<void, TestRunner.TestRunnerFailed>
} = dual(
  2,
  Effect.fn(SpanTaxonomy.Spans.vitestRuntimeStart.name)(
    function*(self: VitestRuntime, testFiles: string[] | undefined) {
      yield* Effect.tryPromise({
        try: () => driverOf(self).start(testFiles),
        catch: (cause) => failRuntime('dryRun')(cause),
      })
    },
  ),
)

export const files = (self: VitestRuntime): readonly RunnerTestFile[] => driverOf(self).state.getFiles()

export const clearFiles = (self: VitestRuntime): void => {
  const driver = driverOf(self)
  clearVitestFiles(driver)
}

export const hasExternalErrors = (self: VitestRuntime): boolean => {
  const driver = driverOf(self)
  return Option.exists(errorCollectionOf(driver), hasEntries)
}

export const externalErrorText = (self: VitestRuntime): string => {
  const driver = driverOf(self)
  return Option.match(errorCollectionOf(driver), {
    onNone: () => '',
    onSome: (collection) => iterableEntriesOf(collection).map(causeTextOf).join('\n'),
  })
}

export const metaOf = <A>(file: A): VitestValue => metaDriverOf(file)

export const testFileModulesOf = <A>(file: A): Option.Option<readonly string[]> => testFileModulesDriverOf(file)

export const dedupeFilesByName = <A = unknown>(files: readonly A[]): Record<string, A> =>
  Object.fromEntries(files.map((file) => [fileKeyOf(file), file]))

export const isRunnerTestSuite = (value: unknown): value is RunnerTestSuite =>
  Predicate.isObject(value) && Array.isArray(value['tasks'])

export const reportAllKillersOf = (options: { readonly disableBail?: boolean }) => options.disableBail === true

export const close = Effect.fn(SpanTaxonomy.Spans.vitestRuntimeClose.name)(function*(self: VitestRuntime) {
  const fs = yield* FileSystem.FileSystem
  onClose(
    driverOf(self),
    fs.remove(self.localSetupFile, { recursive: true, force: true }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.orElseSucceed(() => undefined),
    ),
  )
  yield* Effect.tryPromise({
    try: () => driverOf(self).close(),
    catch: (cause) => failRuntime('dispose')(cause),
  })
})
