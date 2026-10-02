import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { type Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'

import { BaselineTestsFailedEvidence } from './__fixtures__/dry-run-failure.schema.js'

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
  "import { add } from '../src/math.ts'",
  '',
  `test('${PASSING_TEST}', () => {`,
  '  expect(add(1, 1)).toBe(2)',
  '})',
  '',
  `test('${FIRST_FAILING_TEST}', () => {`,
  '  expect(add(1, 1)).toBe(3)',
  '})',
  '',
  `test('${SECOND_FAILING_TEST}', () => {`,
  '  expect(add(2, 2)).toBe(5)',
  '})',
].join('\n')

interface ProjectFixture {
  readonly root: string
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
    return { root }
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(root, { recursive: true })),
  ))

const runFromProject = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<
  Result.Result<Engine.MutationTestDone, Engine.RunFailure | PlatformError>,
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
  outcome: Result.Result<Engine.MutationTestDone, Engine.RunFailure | PlatformError>,
): Engine.RunFailure => {
  if (Result.isSuccess(outcome)) {
    throw new Error('the run was expected to fail its dry run, but it completed')
  }
  if (!S.is(Engine.RunFailure)(outcome.failure)) {
    throw new Error(`the run was expected to fail as a run failure, not a platform failure: ${String(outcome.failure)}`)
  }
  return outcome.failure
}

const OPTIONS: Options.PartialStrykerOptions = {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  reporters: [],
  checkers: [],
}

const FROZEN_RUNNER_PLUGIN = new URL('./__fixtures__/frozen-runner/index.mjs', import.meta.url).href
const DEAF_RUNNER_PLUGIN = new URL('./__fixtures__/deaf-runner/index.mjs', import.meta.url).href

interface WorkerRunnerOutcome {
  readonly outcome: Result.Result<Engine.MutationTestDone, Engine.RunFailure | PlatformError>
  readonly workerPid: number
}

const runWithRunnerPlugin = (
  project: ProjectFixture,
  plugin: string,
): Effect.Effect<WorkerRunnerOutcome, PlatformError, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const pidFile = path.join(project.root, 'test-runner.pid')
    const outcome = yield* runFromProject(project.root, {
      ...OPTIONS,
      testRunner: { plugin, options: { pidFile } },
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(50),
        orElse: () => Effect.die(new Error('the run was still waiting on its test runner after 50s')),
      }),
    )
    const workerPid = Number(yield* fs.readFileString(pidFile))
    return { outcome, workerPid }
  })

const isProcessAlive = (pid: number): boolean => Result.isSuccess(Result.try(() => globalThis.process.kill(pid, 0)))

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Reporting why a dry run failed', { timeout: 120_000 })
  .withLayer(runLayer)
  .live('the scenario writes and removes a real project directory, so the dry run waits on real filesystem I/O')
  .body(({ scenario }) => {
    scenario(
      'A dry run with failing tests names every failing test with its failure message',
      Gherkin.Do.pipe(
        Given('a project whose test suite fails two of its three tests')('project', () => writeProject()),
        When('the mutation run performs its initial test run')(
          'outcome',
          (s) => runFromProject(s.project.root, OPTIONS).pipe(Effect.ensuring(removeProject(s.project.root))),
        ),
        Then(
          'the refusal reports every failing test by id, name and file',
        )((s, expect) => {
          const failure = failureOf(s.outcome)
          const evidence = Option.getOrUndefined(
            S.decodeUnknownOption(BaselineTestsFailedEvidence)(failure.evidence),
          )
          const tests = evidence?.tests ?? []
          const messages = tests.map((test) => test.message)
          return expect({
            evidenceTag: failure.evidence._tag,
            stage: failure.evidence.stage,
            testCount: evidence?.testCount,
            failedTestCount: tests.length,
            failedNames: tests.map((test) => test.name),
            idsNameTheirFileAndTest: tests.every((test) => test.id === `${TEST_FILE}#${test.name}`),
            filesNameTheirTestFile: tests.every((test) => test.file === TEST_FILE),
            messagesAreAssertions: messages.every((message) => message.includes('expected')),
          }).toEqual({
            evidenceTag: 'BaselineTestsFailed',
            stage: 'dryRun',
            testCount: 3,
            failedTestCount: 2,
            failedNames: FAILING_TEST_NAMES,
            idsNameTheirFileAndTest: true,
            filesNameTheirTestFile: true,
            messagesAreAssertions: true,
          })
        }),
      ),
    )
    scenario(
      'A test runner that stops responding fails the dry run instead of hanging it forever',
      Gherkin.Do.pipe(
        Given('a project whose test runner stops responding and ignores requests to shut down')(
          'project',
          () => writeProject(),
        ),
        When('the mutation run performs its initial test run')(
          'run',
          (s) =>
            runWithRunnerPlugin(s.project, FROZEN_RUNNER_PLUGIN).pipe(
              Effect.ensuring(removeProject(s.project.root)),
            ),
        ),
        Then('the dry run fails and the unresponsive test runner does not outlive the run')((s, expect) =>
          expect({
            stage: failureOf(s.run.outcome).evidence.stage,
            workerAlive: isProcessAlive(s.run.workerPid),
          }).toEqual({ stage: 'dryRun', workerAlive: false })
        ),
      ),
    )
    scenario(
      'A test runner that never accepts its connection fails the run with a boot error instead of hanging it',
      Gherkin.Do.pipe(
        Given('a project whose test runner never accepts its connection')('project', () => writeProject()),
        When('the mutation run performs its initial test run')(
          'run',
          (s) =>
            runWithRunnerPlugin(s.project, DEAF_RUNNER_PLUGIN).pipe(
              Effect.ensuring(removeProject(s.project.root)),
            ),
        ),
        Then('the dry run fails and the worker that never accepted its connection does not outlive the run')(
          (s, expect) => {
            const failure = failureOf(s.run.outcome)
            const bootCause = S.is(TestRunner.TestRunnerFailed)(failure.cause) ? failure.cause : undefined
            return expect({
              stage: failure.evidence.stage,
              causeTag: bootCause?._tag,
              causePhase: bootCause?.phase,
              namesTheWorkerPid: bootCause?.cause.includes(`Worker ${s.run.workerPid}`) ?? false,
              namesTheBootWindow: bootCause?.cause.includes(
                'did not accept the RPC connection before its boot window closed',
              ) ?? false,
              workerAlive: isProcessAlive(s.run.workerPid),
            }).toEqual({
              stage: 'dryRun',
              causeTag: 'TestRunnerFailed',
              causePhase: 'init',
              namesTheWorkerPid: true,
              namesTheBootWindow: true,
              workerAlive: false,
            })
          },
        ),
      ),
    )
  })
