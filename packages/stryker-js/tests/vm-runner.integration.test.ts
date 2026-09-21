import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  buildTestRunner,
  createDefaultOptions,
  type PooledTestRunner,
  type PooledTestRunnerError,
  type TestRunnerBuildContext,
  WorkerLauncher,
} from '@systemfsoftware/stryker-js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { DryRunResult, MutantRunResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const workerCanary = Layer.succeed(
  WorkerLauncher,
  WorkerLauncher.of({
    spawn: () => Effect.die(new Error('a worker was launched for an in-memory run')),
  }),
)

const spawnerCanary = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die(new Error('a child process was spawned for an in-memory run'))),
)

const stubPortsLayer = Layer.merge(spawnerCanary, workerCanary)

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const dummyIdGenerator = {
  next: Effect.succeed(1),
}

interface SuiteFixture {
  readonly directory: string
  readonly file: string
  readonly files?: readonly string[]
}

const writeSuites = (
  prefix: string,
  sources: readonly string[],
): Effect.Effect<SuiteFixture, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    const files: string[] = []
    for (const [index, source] of sources.entries()) {
      const file = path.join(directory, `${prefix}-${index}.test.ts`)
      yield* fs.writeFileString(file, source)
      files.push(file)
    }
    return { directory, file: files[0] ?? directory, files }
  }).pipe(Effect.orDie)

const NOTICING_SUITE = [
  'const host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>',
  'const stryker: Record<string, unknown> | undefined = host["__stryker__"] as Record<string, unknown> | undefined',
  'const active: unknown = stryker === undefined ? undefined : stryker.activeMutant',
  'if (active === "mutant-1") {',
  '  throw new Error("the mutated program ran")',
  '}',
].join('\n')

const IGNORING_SUITE = 'globalThis.__strykerRun = "completed"'
const FINALIZER_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  'const { test, hooks } = slot.api',
  '',
  "test('registers a finalizer', () => {",
  '  hooks.onTestFinished(() => {',
  '    globalThis.__FINALIZER_RAN = true',
  '  })',
  '})',
  '',
  "test('observes the finalizer ran', () => {",
  '  if (globalThis.__FINALIZER_RAN !== true) {',
  "    throw new Error('the onTestFinished finalizer did not run')",
  '  }',
  '})',
].join('\n')

const MALFORMED_SUITE = 'const broken: = 1'

const RUNTIME_THROW_SUITE = 'throw new Error("boom at import time")'

const RAW_API_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  'const { describe, it } = slot.api',
  'const hookRan = []',
  'slot.api.hooks.beforeEach(() => { hookRan.push(1) })',
  '',
  "describe('math', () => {",
  "  it('adds numbers', () => {",
  "    if (1 + 1 !== 2) { throw new Error('expected a sum of two') }",
  '  })',
  '',
  "  it('rejects a wrong async sum', async () => {",
  '    const value = await Promise.resolve(2)',
  "    if (value !== 3) { throw new Error('expected the async sum to be three') }",
  '  })',
  '})',
  '',
  "describe('lifecycle', () => {",
  '  it("saw the hook run once per test so far", () => {',
  "    if (hookRan.length !== 3) { throw new Error('expected three hook runs by the last test') }",
  '  })',
  '})',
].join('\n')

const MODULE_STATE_SUITE = [
  'let timesRun = 0',
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  "slot.api.it('starts with no runs on the clock', () => {",
  '  timesRun += 1',
  "  if (timesRun !== 1) { throw new Error('expected a fresh run') }",
  '})',
].join('\n')

const HANGING_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  "slot.api.it('hangs forever', () => new Promise(() => {}))",
].join('\n')

const LATE_REJECTION_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  "slot.api.it('emits a late rejection', () => {",
  "  Promise.reject(new Error('the late rejection arrived'))",
  '})',
].join('\n')

const KILL_ATTRIBUTION_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  'const stryker = globalThis["__stryker__"]',
  'const active = stryker === undefined ? undefined : stryker.activeMutant',
  "slot.api.describe('guards', () => {",
  "  slot.api.it('does not mind the change', () => {})",
  "  slot.api.it('catches the change', () => {",
  "    if (active === 'mutant-1') { throw new Error('the mutated program ran') }",
  '  })',
  '})',
].join('\n')

const writeSuite = (
  prefix: string,
  source: string,
): Effect.Effect<SuiteFixture, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    const file = path.join(directory, `${prefix}.test.ts`)
    yield* fs.writeFileString(file, source)
    return { directory, file }
  }).pipe(Effect.orDie)

const removeSuite = (directory: string): Effect.Effect<void> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(directory, { recursive: true })),
    Effect.provide(suiteFileLayer),
    Effect.orDie,
  )

const buildContextFor = (
  fixture: SuiteFixture,
  testFilesOverride?: readonly string[],
): Effect.Effect<TestRunnerBuildContext> =>
  Effect.gen(function*() {
    const defaults = yield* createDefaultOptions
    return {
      options: { ...defaults, testRunner: 'vm' },
      fileDescriptions: {},
      sandboxWorkingDirectory: fixture.directory,
      idGenerator: dummyIdGenerator,
      retire: Effect.void,
      testFiles: testFilesOverride ?? fixture.files ?? [fixture.file],
    }
  })

const mutantFor = (fileName: string): Mutant =>
  Mutant.make({
    id: 'mutant-1',
    fileName,
    mutatorName: 'ArithmeticOperator',
    replacement: '-',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  })

interface RunOutcome {
  readonly dryRun: DryRunResult
  readonly mutantRun: MutantRunResult
  readonly elapsedMs: number
}

const runnerFor = (fixture: SuiteFixture): Effect.Effect<PooledTestRunner, never, never> =>
  Effect.gen(function*() {
    const context = yield* buildContextFor(fixture)
    const neverSpawned = Effect.die(new Error('the child-process runner was built for an in-memory run'))
    return yield* buildTestRunner(context, neverSpawned)
  }).pipe(
    Effect.provide(Layer.mergeAll(suiteFileLayer, stubPortsLayer)),
    Effect.scoped,
    Effect.orDie,
  )

const runSuite = (fixture: SuiteFixture): Effect.Effect<RunOutcome, never, never> =>
  Effect.gen(function*() {
    const runner = yield* runnerFor(fixture)
    const dryRun = yield* runner.dryRun({ timeout: 5000, coverageAnalysis: 'off', disableBail: false })
    const timed = yield* Effect.timed(
      runner.mutantRun({
        timeout: 5000,
        disableBail: false,
        activeMutant: mutantFor(fixture.file),
        sandboxFileName: fixture.file,
        mutantActivation: 'runtime',
        reloadEnvironment: true,
      }),
    )
    return { dryRun, mutantRun: timed[1], elapsedMs: Duration.toMillis(timed[0]) }
  }).pipe(Effect.orDie, Effect.ensuring(removeSuite(fixture.directory)))

const suiteFailure = (
  fixture: SuiteFixture,
  testFiles?: readonly string[],
): Effect.Effect<Exit.Exit<DryRunResult, PooledTestRunnerError>, never, never> =>
  Effect.gen(function*() {
    const context = yield* buildContextFor(fixture, testFiles)
    const runner = yield* buildTestRunner(
      context,
      Effect.die(
        new Error('the child-process runner was built for an in-memory run'),
      ),
    )
    return yield* runner.dryRun({ timeout: 5000, coverageAnalysis: 'off', disableBail: false }).pipe(Effect.exit)
  }).pipe(
    Effect.provide(Layer.mergeAll(suiteFileLayer, stubPortsLayer)),
    Effect.scoped,
    Effect.orDie,
    Effect.ensuring(removeSuite(fixture.directory)),
  )

Feature('Verifying mutants without spawning a child process')
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A suite that notices the mutant is reported as catching it',
      Gherkin.Do.pipe(
        Given('a written suite whose assertions fail once the mutant runs')(
          'suite',
          () => writeSuite('noticing', NOTICING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner verifies that mutant')(
          'outcome',
          (s) => runSuite(s.suite),
        ),
        Then('the initial run passes, the mutant is caught, and the run stays under a handful of milliseconds')((s) =>
          Effect.sync(() => {
            expect(s.outcome.dryRun.status).toBe('complete')
            expect(s.outcome.mutantRun.status).toBe('killed')
            expect(s.outcome.elapsedMs).toBeLessThan(50)
          })
        ),
      ),
    )

    scenario(
      'A suite that ignores the mutant is reported as letting it survive',
      Gherkin.Do.pipe(
        Given('a written suite that passes once the mutant runs')(
          'suite',
          () => writeSuite('ignoring', IGNORING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner verifies that mutant')(
          'outcome',
          (s) => runSuite(s.suite),
        ),
        Then('the initial run passes and the mutant is reported as surviving')((s) =>
          Effect.sync(() => {
            expect(s.outcome.dryRun.status).toBe('complete')
            expect(s.outcome.mutantRun.status).toBe('survived')
          })
        ),
      ),
    )

    scenario(
      'Cleanup registered during a test runs before the next test starts',
      Gherkin.Do.pipe(
        Given('a written suite whose second test depends on the first test cleanup having run')(
          'suite',
          () => writeSuite('finalizer', FINALIZER_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner runs the suite')(
          'attempt',
          (s) => suiteFailure(s.suite),
        ),
        Then('the run reports both tests as passing')((s) =>
          Effect.sync(() => {
            expect(Exit.isSuccess(s.attempt)).toBe(true)
            if (Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete') {
              const tests = s.attempt.value.tests
              expect(tests.map((test) => test.name)).toEqual(['registers a finalizer', 'observes the finalizer ran'])
              expect(tests.every((test) => test.status === 'success')).toBe(true)
            }
          })
        ),
      ),
    )

    scenario(
      'A suite that cannot be compiled stops the run with a failure naming the file',
      Gherkin.Do.pipe(
        Given('a written suite whose TypeScript is malformed')(
          'suite',
          () => writeSuite('malformed', MALFORMED_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner verifies a mutant in it')(
          'attempt',
          (s) => suiteFailure(s.suite),
        ),
        Then('the run fails with a typed failure that names the malformed file')((s) =>
          Effect.sync(() => {
            expect(Exit.isFailure(s.attempt)).toBe(true)
            if (Exit.isFailure(s.attempt)) {
              const failure = Cause.findErrorOption(s.attempt.cause)
              const described = Match.value(failure).pipe(
                Match.when(Option.isNone, () => 'no failure was reported'),
                Match.orElse((reported) =>
                  Match.value(reported.value).pipe(
                    Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
                    Match.orElse(() => 'a different failure was reported'),
                  )
                ),
              )
              expect(described).toContain('init')
              expect(described).toContain('malformed.test.ts')
            }
          })
        ),
      ),
    )

    scenario(
      'Each test in a suite is reported on its own',
      Gherkin.Do.pipe(
        Given('a suite with passing, failing, and nested tests, and a hook around each test')(
          'suite',
          () => writeSuite('per-test', RAW_API_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner checks the suite before any mutant runs')(
          'outcome',
          (s) =>
            Effect.flatMap(
              runnerFor(s.suite),
              (runner) => runner.dryRun({ timeout: 5000, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('every test is reported separately with its own outcome and hook history')((s) =>
          Effect.sync(() => {
            const outcome = s.outcome
            expect(outcome.status).toBe('complete')
            if (outcome.status !== 'complete') {
              throw new Error('the dry run did not complete')
            }
            const byName = new Map(outcome.tests.map((test) => [test.name, test]))
            expect(byName.get('math > adds numbers')).toMatchObject({ status: 'success' })
            expect(byName.get('math > rejects a wrong async sum')).toMatchObject({
              status: 'failed',
              failureMessage: 'expected the async sum to be three',
            })
            expect(byName.get('lifecycle > saw the hook run once per test so far')).toMatchObject({ status: 'success' })
            const ids = outcome.tests.map((test) => test.id)
            expect(new Set(ids).size).toBe(ids.length)
            for (const id of ids) {
              expect(id).toContain('#')
            }
          })
        ),
      ),
    )

    scenario(
      'Module state starts fresh on every verification run',
      Gherkin.Do.pipe(
        Given('a suite whose tests count how many times they have run')(
          'suite',
          () => writeSuite('module-state', MODULE_STATE_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner checks the suite twice in a row')(
          'outcome',
          (s) => runSuite(s.suite),
        ),
        Then('the second run starts from clean module state and the change survives')((s) =>
          Effect.sync(() => {
            expect(s.outcome.dryRun.status).toBe('complete')
            expect(s.outcome.mutantRun.status).toBe('survived')
          })
        ),
      ),
    )

    scenario(
      'A test that never finishes stops the run in time',
      Gherkin.Do.pipe(
        Given('a suite whose only test waits forever')(
          'suite',
          () => writeSuite('hanging', HANGING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner checks the suite with a short time budget')(
          'outcome',
          (s) =>
            Effect.flatMap(
              runnerFor(s.suite),
              (runner) => runner.dryRun({ timeout: 200, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('the run is reported as timed out rather than hanging forever')((s) =>
          Effect.sync(() => {
            expect(s.outcome.status).toBe('timeout')
          })
        ),
      ),
    )

    scenario(
      'A promise that fails after its test finished is still reported',
      Gherkin.Do.pipe(
        Given('a suite whose test leaves behind a failing promise')(
          'suite',
          () => writeSuite('late-rejection', LATE_REJECTION_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner checks the suite before any mutant runs')(
          'outcome',
          (s) =>
            Effect.flatMap(
              runnerFor(s.suite),
              (runner) => runner.dryRun({ timeout: 5000, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('the run reports the late failure even though its test passed')((s) =>
          Effect.sync(() => {
            const outcome = s.outcome
            expect(outcome.status).toBe('complete')
            if (outcome.status !== 'complete') {
              throw new Error('the dry run did not complete')
            }
            expect(outcome.tests.find((test) => test.name === 'emits a late rejection')).toMatchObject({
              status: 'success',
            })
            expect(outcome.tests.some((test) =>
              test.status === 'failed' && typeof test.failureMessage === 'string' &&
              test.failureMessage.includes('the late rejection arrived')
            )).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Only the tests that catch a change are reported as its killers',
      Gherkin.Do.pipe(
        Given('a suite where one test guards the change and another ignores it')(
          'suite',
          () => writeSuite('kill-attribution', KILL_ATTRIBUTION_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the in-memory runner verifies the change in it')(
          'outcome',
          (s) => runSuite(s.suite),
        ),
        Then('the run is killed by exactly the guarding test')((s) =>
          Effect.sync(() => {
            expect(s.outcome.dryRun.status).toBe('complete')
            const killed = s.outcome.mutantRun
            expect(killed.status).toBe('killed')
            if (killed.status !== 'killed') {
              throw new Error('the change was not killed')
            }
            expect(killed.killedBy).toHaveLength(1)
            expect(killed.killedBy[0]?.endsWith('#guards > catches the change')).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'A project with nothing to run still reports a completed initial run',
      Gherkin.Do.pipe(
        Given('a written project whose test file list is empty')(
          'suite',
          () => writeSuite('empty-list', IGNORING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner performs the initial run without any test files')(
          'attempt',
          (s) => suiteFailure(s.suite, []),
        ),
        Then('the run completes and reports no tests')((s) =>
          Effect.sync(() => {
            expect(Exit.isSuccess(s.attempt)).toBe(true)
            if (Exit.isSuccess(s.attempt)) {
              expect(s.attempt.value.status).toBe('complete')
              if (s.attempt.value.status === 'complete') {
                expect(s.attempt.value.tests).toEqual([
                  { id: 'all', name: 'All tests', status: 'success', timeSpentMs: 0 },
                ])
              }
            }
          })
        ),
      ),
    )

    scenario(
      'A later file that cannot be compiled stops the run naming that file',
      Gherkin.Do.pipe(
        Given('a written project whose first file runs cleanly and whose second file is malformed')(
          'suite',
          () => writeSuites('mixed', [IGNORING_SUITE, MALFORMED_SUITE]).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner performs the initial run')(
          'attempt',
          (s) => suiteFailure(s.suite),
        ),
        Then('the run stops with an initialization failure naming the second file')((s) =>
          Effect.sync(() => {
            expect(Exit.isFailure(s.attempt)).toBe(true)
            if (Exit.isFailure(s.attempt)) {
              const failure = Cause.findErrorOption(s.attempt.cause)
              const described = Match.value(failure).pipe(
                Match.when(Option.isNone, () => 'no failure was reported'),
                Match.orElse((reported) =>
                  Match.value(reported.value).pipe(
                    Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
                    Match.orElse(() => 'a different failure was reported'),
                  )
                ),
              )
              expect(described).toContain('init')
              expect(described).toContain('mixed-1.test.ts')
            }
          })
        ),
      ),
    )

    scenario(
      'A file that fails while loading is reported as a failed test beside the tests that ran',
      Gherkin.Do.pipe(
        Given('a written project whose first file passes and whose second file throws as it loads')(
          'suite',
          () => writeSuites('load-error', [RAW_API_SUITE, RUNTIME_THROW_SUITE]).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner performs the initial run')(
          'attempt',
          (s) => suiteFailure(s.suite),
        ),
        Then('the run completes and reports the load failure as its own failed test')((s) =>
          Effect.sync(() => {
            expect(Exit.isSuccess(s.attempt)).toBe(true)
            if (Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete') {
              const tests = s.attempt.value.tests
              const loadFailure = tests.find((test) => test.name.endsWith('.test.ts (load error)'))
              expect(loadFailure).toBeDefined()
              expect(loadFailure?.status).toBe('failed')
              if (loadFailure?.status === 'failed') {
                expect(loadFailure.failureMessage).toContain('boom at import time')
              }
              expect(tests.some((test) => test.name === 'math > adds numbers')).toBe(true)
            }
          })
        ),
      ),
    )
  })
