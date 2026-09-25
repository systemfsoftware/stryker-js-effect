import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'

import { DryRunFailedCause, type DryRunFailedView } from './__fixtures__/dry-run-failure.schema.js'

const Feature = makeFeature({ it })

const PASSING_TEST = 'accepts a correct sum'
const FIRST_FAILING_TEST = 'rejects a wrong sum of one and one'
const SECOND_FAILING_TEST = 'rejects a wrong sum of two and two'
const FAILING_TEST_NAMES = [FIRST_FAILING_TEST, SECOND_FAILING_TEST]

const SOURCE_FILE = 'src/math.ts'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'

const TEST_FILE = 'test/math.test.mjs'
const TEST_CONTENT = [
  "import { expect, test } from 'vitest'",
  '',
  `test('${PASSING_TEST}', () => {`,
  '  expect(1 + 1).toBe(2)',
  '})',
  '',
  `test('${FIRST_FAILING_TEST}', () => {`,
  '  expect(1 + 1).toBe(3)',
  '})',
  '',
  `test('${SECOND_FAILING_TEST}', () => {`,
  '  expect(2 + 2).toBe(5)',
  '})',
].join('\n')

interface LogEntry {
  readonly level: string
  readonly text: string
}

interface ProjectFixture {
  readonly root: string
  readonly logs: Array<LogEntry>
}

const writeProject = (): Effect.Effect<ProjectFixture, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(path.join(root, SOURCE_FILE), SOURCE_CONTENT)
    yield* fs.writeFileString(path.join(root, TEST_FILE), TEST_CONTENT)
    return { root, logs: [] }
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(root, { recursive: true })),
  ))

const capturingLogger = (fixture: ProjectFixture): Layer.Layer<never> =>
  Logger.layer([
    Logger.make((entry) => {
      fixture.logs.push({
        level: entry.logLevel,
        text: [entry.message].flat().map(String).join(' '),
      })
    }),
  ])

const runFromProject = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<
  Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>,
  never,
  Engine.EnginePorts
> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () => Effect.result(Engine.strykerCell(options)),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const failureOf = (
  outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>,
): Engine.StageError => {
  if (Result.isSuccess(outcome)) {
    throw new Error('the run was expected to fail its dry run, but it completed')
  }
  if (!S.is(Engine.StageError)(outcome.failure)) {
    throw new Error(`the run was expected to fail as a stage, not a platform failure: ${String(outcome.failure)}`)
  }
  return outcome.failure
}

const dryRunFailedCauseOf = (cause: Engine.StageError['cause']): Option.Option<DryRunFailedView> =>
  S.decodeUnknownOption(DryRunFailedCause)(cause)

const OPTIONS: Options.PartialStrykerOptions = {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  reporters: [],
  checkers: [],
}

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Reporting why a dry run failed')
  .withLayer(runLayer)
  .live('the scenario writes and removes a real project directory, so the dry run waits on real filesystem I/O')
  .body(({ scenario }) => {
    scenario(
      'A dry run with failing tests names every failing test with its failure message',
      Gherkin.Do.pipe(
        Given('a project whose test suite fails two of its three tests')('project', () => writeProject()),
        When('the mutation run performs its initial test run')(
          'outcome',
          (s) =>
            runFromProject(s.project.root, OPTIONS).pipe(
              Effect.provide(capturingLogger(s.project)),
              Effect.ensuring(removeProject(s.project.root)),
            ),
        ),
        Then(
          'the refusal names every failing test with its failure message, in the cause, the reason, and the log',
        )((s, expect) => {
          const failure = failureOf(s.outcome)
          const cause = Option.getOrUndefined(dryRunFailedCauseOf(failure.cause))
          const messages = cause?.failedTests.map((test) => test.failureMessage) ?? []
          const errorLog = s.project.logs
            .filter((entry) => entry.level === 'Error')
            .map((entry) => entry.text)
            .join('\n')
          return expect({
            stage: failure.stage,
            causeTag: cause?._tag,
            causeTestCount: cause?.testCount,
            causeFailedTestCount: cause?.failedTestCount,
            causeFailedNames: cause?.failedTests.map((test) => test.name),
            reasonNamesEveryFailure: FAILING_TEST_NAMES.every((name) => failure.reason.includes(name)),
            reasonCarriesEveryMessage: messages.every((message) => failure.reason.includes(message)),
            messagesAreAssertions: messages.every((message) => message.includes('expected')),
            logNamesEveryFailure: FAILING_TEST_NAMES.every((name) => errorLog.includes(name)),
            logCarriesEveryMessage: messages.every((message) => errorLog.includes(message)),
            logCountsTheFailures: errorLog.includes('2 of 3 test(s) failed'),
          }).toEqual({
            stage: 'dryRun',
            causeTag: 'DryRunFailed',
            causeTestCount: 3,
            causeFailedTestCount: 2,
            causeFailedNames: FAILING_TEST_NAMES,
            reasonNamesEveryFailure: true,
            reasonCarriesEveryMessage: true,
            messagesAreAssertions: true,
            logNamesEveryFailure: true,
            logCarriesEveryMessage: true,
            logCountsTheFailures: true,
          })
        }),
      ),
    )
  })
