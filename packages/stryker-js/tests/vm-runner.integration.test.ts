import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Plugin, Worker } from '@systemfsoftware/stryker-js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

const Feature = makeFeature({ it })

const workerCanary = Layer.succeed(
  Worker.WorkerLauncher,
  Worker.WorkerLauncher.of({
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

const SANDBOX_DEPENDENCIES = decodeURIComponent(new URL('../node_modules', import.meta.url).pathname)

const linkSandboxDependencies = (
  directory: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.symlink(SANDBOX_DEPENDENCIES, path.join(directory, 'node_modules'))
  }).pipe(Effect.orDie)

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
    yield* linkSandboxDependencies(directory)
    const files: string[] = []
    for (const [index, source] of sources.entries()) {
      const file = path.join(directory, `${prefix}-${index}.test.ts`)
      yield* fs.writeFileString(file, source)
      files.push(file)
    }
    return { directory, file: files[0] ?? directory, files }
  }).pipe(Effect.orDie)

const NOTICING_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  'const stryker = globalThis["__stryker__"]',
  'const active: unknown = stryker === undefined ? undefined : stryker.activeMutant',
  "slot.api.it('notices the change', () => {",
  '  if (active === "mutant-1") {',
  '    throw new Error("the mutated program ran")',
  '  }',
  '})',
].join('\n')

const IGNORING_SUITE = [
  'const slot = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]',
  "slot.api.it('ignores the change', () => {})",
].join('\n')
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

const SPINNING_SUITE = [
  "import { test } from 'vitest'",
  '',
  "test('spins forever', () => {",
  '  while (true) {}',
  '})',
].join('\n')

const EXITING_SUITE = [
  "import { test } from 'vitest'",
  '',
  "test('ends the program', () => {",
  '  process.exit(3)',
  '})',
].join('\n')

const OVERLAPPING_SUITE = (marker: string): string =>
  [
    "import { test } from 'vitest'",
    "import { appendFileSync } from 'node:fs'",
    "import { dirname, join } from 'node:path'",
    '',
    'const workerFile = (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__?.filepath ?? globalThis.process.cwd()',
    `const stampFile = join(dirname(workerFile), ${JSON.stringify(`${marker}.stamps`)})`,
    `test(${JSON.stringify(`overlaps ${marker}`)}, async () => {`,
    '  const { promise, resolve } = Promise.withResolvers<void>()',
    '  setTimeout(resolve, 300)',
    '  appendFileSync(stampFile, `start ${performance.now()}\\n`)',
    '  await promise',
    '  appendFileSync(stampFile, `end ${performance.now()}\\n`)',
    '})',
  ].join('\n')

const OUTSIDE_HOOK_SUITE = [
  "import { test, beforeEach } from 'vitest'",
  '',
  'beforeEach(() => {',
  '  const told = (globalThis as { __OUTSIDE_HOOK__?: string[] }).__OUTSIDE_HOOK__ ?? []',
  '  told.push("outside hook ran")',
  '  ;(globalThis as { __OUTSIDE_HOOK__?: string[] }).__OUTSIDE_HOOK__ = told',
  '})',
  '',
  "test('first file test', () => {})",
].join('\n')

const OUTSIDE_HOOK_VICTIM_SUITE = [
  "import { test } from 'vitest'",
  '',
  "test('second file test', () => {",
  '  const told = (globalThis as { __OUTSIDE_HOOK__?: string[] }).__OUTSIDE_HOOK__',
  '  if (told !== undefined && told.length > 0) {',
  '    throw new Error("the other file\'s hook ran here")',
  '  }',
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
    yield* linkSandboxDependencies(directory)
    const file = path.join(directory, `${prefix}.test.ts`)
    yield* fs.writeFileString(file, source)
    return { directory, file }
  }).pipe(Effect.orDie)
const writeEmptyProject = (): Effect.Effect<SuiteFixture, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectory()
    return { directory, file: directory, files: [] }
  }).pipe(Effect.orDie)
const readStamps = (
  directory: string,
  marker: string,
): Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const raw = yield* fs.readFileString(path.join(directory, `${marker}.stamps`)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return raw.split('\n').filter((line) => line.length > 0)
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
): Effect.Effect<Plugin.TestRunnerBuildContext> =>
  Effect.gen(function*() {
    const defaults = yield* Configuration.StrykerConfig.createDefaultOptions
    return {
      options: { ...defaults, testRunner: 'vm' },
      fileDescriptions: {},
      sandboxWorkingDirectory: fixture.directory,
      idGenerator: dummyIdGenerator,
      retire: Effect.void,
      testFiles: testFilesOverride ?? fixture.files ?? [fixture.file],
    }
  })

const mutantFor = (fileName: string): Mutant.Mutant =>
  Mutant.Mutant.make({
    id: Mutant.MutantId.make('mutant-1'),
    fileName: Mutant.CanonicalFileName.make(fileName),
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: '-',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  })

interface RunOutcome {
  readonly dryRun: TestRunner.DryRunResult
  readonly mutantRun: TestRunner.MutantRunResult
}

const runnerFor = (fixture: SuiteFixture): Effect.Effect<Plugin.PooledTestRunner, never, Scope.Scope> =>
  Effect.gen(function*() {
    const context = yield* buildContextFor(fixture)
    const neverSpawned = Effect.die(new Error('the child-process runner was built for an in-memory run'))
    return yield* Plugin.buildTestRunner(context, neverSpawned)
  }).pipe(Effect.provide(Layer.mergeAll(suiteFileLayer, stubPortsLayer)), Effect.orDie)

const COMPLETION_BUDGET_MS = 30_000

const runSuite = (fixture: SuiteFixture): Effect.Effect<RunOutcome, never, never> =>
  Effect.gen(function*() {
    const runner = yield* runnerFor(fixture)
    const dryRun = yield* runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false })
    const mutantRun = yield* runner.mutantRun({
      timeout: COMPLETION_BUDGET_MS,
      disableBail: false,
      activeMutant: mutantFor(fixture.file),
      sandboxFileName: fixture.file,
      mutantActivation: 'runtime',
      reloadEnvironment: true,
    })
    return { dryRun, mutantRun }
  }).pipe(Effect.scoped, Effect.orDie, Effect.ensuring(removeSuite(fixture.directory)))

interface WorkerLifetime {
  readonly before: readonly string[]
  readonly during: readonly string[]
  readonly after: readonly string[]
  readonly dryRun: TestRunner.DryRunResult
}

const workerResourceNames = (): readonly string[] =>
  globalThis.process.getActiveResourcesInfo().filter((name) => name === 'Worker' || name === 'MessagePort')

const workerLifetime = (fixture: SuiteFixture): Effect.Effect<WorkerLifetime, never, never> =>
  Effect.gen(function*() {
    const before = workerResourceNames()
    const live = yield* Effect.gen(function*() {
      const runner = yield* runnerFor(fixture)
      const dryRun = yield* runner.dryRun({
        timeout: COMPLETION_BUDGET_MS,
        coverageAnalysis: 'off',
        disableBail: false,
      })
      return { dryRun, during: workerResourceNames() }
    }).pipe(Effect.scoped)
    return { before, during: live.during, after: workerResourceNames(), dryRun: live.dryRun }
  }).pipe(Effect.orDie, Effect.ensuring(removeSuite(fixture.directory)))

const suiteFailure = (
  fixture: SuiteFixture,
  testFiles?: readonly string[],
): Effect.Effect<Exit.Exit<TestRunner.DryRunResult, Plugin.PooledTestRunnerError>, never, never> =>
  Effect.gen(function*() {
    const context = yield* buildContextFor(fixture, testFiles)
    const runner = yield* Plugin.buildTestRunner(
      context,
      Effect.die(
        new Error('the child-process runner was built for an in-memory run'),
      ),
    )
    return yield* runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false }).pipe(
      Effect.exit,
    )
  }).pipe(
    Effect.provide(Layer.mergeAll(suiteFileLayer, stubPortsLayer)),
    Effect.scoped,
    Effect.orDie,
    Effect.ensuring(removeSuite(fixture.directory)),
  )

Feature('Verifying mutants without spawning a child process', { timeout: 180_000 })
  .withLayer(Layer.empty)
  .live('the runner starts a real worker thread and reads and writes suite files on the host filesystem')
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
        Then('the initial run passes and the mutant is caught')((s, expect) =>
          expect({
            dryRunStatus: s.outcome.dryRun.status,
            mutantStatus: s.outcome.mutantRun.status,
          }).toEqual({ dryRunStatus: 'complete', mutantStatus: 'killed' })
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
        Then('the initial run passes and the mutant is reported as surviving')((s, expect) =>
          expect({
            dryRunStatus: s.outcome.dryRun.status,
            mutantStatus: s.outcome.mutantRun.status,
          }).toEqual({ dryRunStatus: 'complete', mutantStatus: 'survived' })
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
        Then('the run reports both tests as passing')((s, expect) => {
          const tests = Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete' ? s.attempt.value.tests : []
          return expect({
            runCompleted: Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete',
            testNames: tests.map((test) => test.name),
            everyTestPassed: tests.length > 0 && tests.every((test) => test.status === 'success'),
          }).toEqual({
            runCompleted: true,
            testNames: ['registers a finalizer', 'observes the finalizer ran'],
            everyTestPassed: true,
          })
        }),
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
        Then('the run fails with a typed failure that names the malformed file')((s, expect) => {
          const failure = Exit.isFailure(s.attempt) ? Cause.findErrorOption(s.attempt.cause) : Option.none()
          const described = Match.value(failure).pipe(
            Match.when(Option.isNone, () => 'no failure was reported'),
            Match.orElse((reported) =>
              Match.value(reported.value).pipe(
                Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
                Match.orElse(() => 'a different failure was reported'),
              )
            ),
          )
          return expect({
            runFailed: Exit.isFailure(s.attempt),
            describedNamesInit: described.includes('init'),
            describedNamesFile: described.includes('malformed.test.ts'),
          }).toEqual({ runFailed: true, describedNamesInit: true, describedNamesFile: true })
        }),
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
              (runner) => runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('every test is reported separately with its own outcome and hook history')((s, expect) => {
          const outcome = s.outcome
          const tests = outcome.status === 'complete' ? outcome.tests : []
          const byName = new Map(tests.map((test) => [test.name, test]))
          const ids = tests.map((test) => test.id)
          return expect({
            completed: outcome.status === 'complete',
            addsNumbers: byName.get('math > adds numbers'),
            rejectsAsync: byName.get('math > rejects a wrong async sum'),
            lifecycle: byName.get('lifecycle > saw the hook run once per test so far'),
            uniqueIds: new Set(ids).size === ids.length,
            idsCarryHash: ids.length > 0 && ids.every((id) => id.includes('#')),
          }).toMatchObject({
            completed: true,
            addsNumbers: { status: 'success' },
            rejectsAsync: { status: 'failed', failureMessage: 'expected the async sum to be three' },
            lifecycle: { status: 'success' },
            uniqueIds: true,
            idsCarryHash: true,
          })
        }),
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
        Then('the second run starts from clean module state and the change survives')((s, expect) =>
          expect({
            dryRunStatus: s.outcome.dryRun.status,
            mutantStatus: s.outcome.mutantRun.status,
          }).toEqual({ dryRunStatus: 'complete', mutantStatus: 'survived' })
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
        Then('the run is reported as timed out rather than hanging forever')((s, expect) =>
          expect(s.outcome.status).toEqual('timeout')
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
              (runner) => runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('the run reports the late failure even though its test passed')((s, expect) => {
          const outcome = s.outcome
          const tests = outcome.status === 'complete' ? outcome.tests : []
          return expect({
            completed: outcome.status === 'complete',
            passedTest: tests.find((test) => test.name === 'emits a late rejection'),
            lateFailureReported: tests.some((test) =>
              test.status === 'failed' && typeof test.failureMessage === 'string' &&
              test.failureMessage.includes('the late rejection arrived')
            ),
          }).toMatchObject({
            completed: true,
            passedTest: { status: 'success' },
            lateFailureReported: true,
          })
        }),
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
        Then('the run is killed by exactly the guarding test')((s, expect) => {
          const killed = s.outcome.mutantRun
          return expect({
            dryRunStatus: s.outcome.dryRun.status,
            mutantStatus: killed.status,
            killedCount: killed.status === 'killed' ? killed.killedBy.length : -1,
            killedByGuardingTest: killed.status === 'killed' &&
              killed.killedBy.length === 1 &&
              (killed.killedBy[0]?.endsWith('#guards > catches the change') ?? false),
          }).toEqual({
            dryRunStatus: 'complete',
            mutantStatus: 'killed',
            killedCount: 1,
            killedByGuardingTest: true,
          })
        }),
      ),
    )

    scenario(
      'A project with nothing to run stops the run naming the runner',
      Gherkin.Do.pipe(
        Given('a project whose folder holds no test files at all')(
          'suite',
          () => writeEmptyProject().pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner performs the initial run without any test files')(
          'attempt',
          (s) => suiteFailure(s.suite, []),
        ),
        Then('the run is refused with guidance to point the runner at test files')((s, expect) => {
          const failure = Exit.isFailure(s.attempt) ? Cause.findErrorOption(s.attempt.cause) : Option.none()
          const described = Match.value(failure).pipe(
            Match.when(Option.isNone, () => 'no failure was reported'),
            Match.orElse((reported) =>
              Match.value(reported.value).pipe(
                Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
                Match.orElse(() => 'a different failure was reported'),
              )
            ),
          )
          return expect({
            runFailed: Exit.isFailure(s.attempt),
            describedNamesInit: described.includes('init'),
            describedNamesRunner: described.includes('"vm"'),
            describedNamesTestFiles: described.includes('testFiles'),
          }).toEqual({
            runFailed: true,
            describedNamesInit: true,
            describedNamesRunner: true,
            describedNamesTestFiles: true,
          })
        }),
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
        Then('the run stops with an initialization failure naming the second file')((s, expect) => {
          const failure = Exit.isFailure(s.attempt) ? Cause.findErrorOption(s.attempt.cause) : Option.none()
          const described = Match.value(failure).pipe(
            Match.when(Option.isNone, () => 'no failure was reported'),
            Match.orElse((reported) =>
              Match.value(reported.value).pipe(
                Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
                Match.orElse(() => 'a different failure was reported'),
              )
            ),
          )
          return expect({
            runFailed: Exit.isFailure(s.attempt),
            describedNamesInit: described.includes('init'),
            describedNamesSecondFile: described.includes('mixed-1.test.ts'),
          }).toEqual({ runFailed: true, describedNamesInit: true, describedNamesSecondFile: true })
        }),
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
        Then('the run completes and reports the load failure as its own failed test')((s, expect) => {
          const completed = Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete'
          const tests = Exit.isSuccess(s.attempt) && s.attempt.value.status === 'complete' ? s.attempt.value.tests : []
          const loadFailure = tests.find((test) => test.name.endsWith('.test.ts (load error)'))
          return expect({
            runCompleted: completed,
            loadFailure,
            loadFailureNamesError: loadFailure?.status === 'failed' &&
              loadFailure.failureMessage.includes('boom at import time'),
            ranMathTest: tests.some((test) => test.name === 'math > adds numbers'),
          }).toMatchObject({
            runCompleted: true,
            loadFailure: { status: 'failed' },
            loadFailureNamesError: true,
            ranMathTest: true,
          })
        }),
      ),
    )

    scenario(
      'A test that never stops executing is reported as timed out and the next run starts over',
      Gherkin.Do.pipe(
        Given('a written suite whose only test spins forever without ever awaiting')(
          'suite',
          () => writeSuite('spinning', SPINNING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner checks the suite and then checks it again on the same runner')(
          'attempts',
          (s) =>
            Effect.gen(function*() {
              const runner = yield* runnerFor(s.suite)
              const first = yield* runner.dryRun({ timeout: 300, coverageAnalysis: 'off', disableBail: false }).pipe(
                Effect.exit,
              )
              const second = yield* runner.dryRun({
                timeout: COMPLETION_BUDGET_MS,
                coverageAnalysis: 'off',
                disableBail: false,
              })
              return { first, second }
            }).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('each run is reported as timed out and the runner recovers between them')((s, expect) =>
          expect({
            firstTimedOut: Exit.isSuccess(s.attempts.first)
              ? s.attempts.first.value.status === 'timeout'
              : false,
            secondTimedOut: s.attempts.second.status === 'timeout',
          }).toEqual({ firstTimedOut: true, secondTimedOut: true })
        ),
      ),
    )

    scenario(
      'A test that ends the whole program is reported as an error and the next run starts over',
      Gherkin.Do.pipe(
        Given('a written suite whose only test asks the program to end immediately')(
          'suite',
          () => writeSuite('exiting', EXITING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner checks the suite and then checks it again on the same runner')(
          'attempts',
          (s) =>
            Effect.gen(function*() {
              const runner = yield* runnerFor(s.suite)
              const first = yield* runner.dryRun({
                timeout: COMPLETION_BUDGET_MS,
                coverageAnalysis: 'off',
                disableBail: false,
              }).pipe(
                Effect.exit,
              )
              const second = yield* runner.dryRun({
                timeout: COMPLETION_BUDGET_MS,
                coverageAnalysis: 'off',
                disableBail: false,
              })
              return { first, second }
            }).pipe(Effect.ensuring(removeSuite(s.suite.directory))),
        ),
        Then('the first run is reported as an error and the second passes from a fresh start')((s, expect) => {
          const firstStatus = Exit.isSuccess(s.attempts.first) ? s.attempts.first.value.status : 'not-success'
          return expect({
            firstSucceeded: Exit.isSuccess(s.attempts.first),
            firstStatusIsCompleteOrError: firstStatus === 'complete' || firstStatus === 'error',
            secondStatus: s.attempts.second.status,
          }).toEqual({
            firstSucceeded: true,
            firstStatusIsCompleteOrError: true,
            secondStatus: 'complete',
          })
        }),
      ),
    )

    scenario(
      'Two runners checked at the same time do not wait for each other',
      Gherkin.Do.pipe(
        Given('two written suites whose only test stamps when its body runs')(
          'suites',
          () =>
            Effect.all([
              writeSuite('slow-a', OVERLAPPING_SUITE('slow-a')).pipe(Effect.provide(suiteFileLayer)),
              writeSuite('slow-b', OVERLAPPING_SUITE('slow-b')).pipe(Effect.provide(suiteFileLayer)),
            ]),
        ),
        When('each runner checks its own suite and both checks run side by side')(
          'checked',
          (s) =>
            Effect.gen(function*() {
              const runners = yield* Effect.forEach(s.suites, (suite) => runnerFor(suite))
              const results = yield* Effect.forEach(
                runners,
                (runner) =>
                  runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false }),
                { concurrency: 'unbounded' },
              )
              const stamps = yield* Effect.all([
                readStamps(s.suites[0].directory, 'slow-a').pipe(Effect.provide(suiteFileLayer)),
                readStamps(s.suites[1].directory, 'slow-b').pipe(Effect.provide(suiteFileLayer)),
              ])
              return { results, stamps }
            }).pipe(
              Effect.ensuring(Effect.forEach(s.suites, (suite) => removeSuite(suite.directory), {
                concurrency: 'unbounded',
              })),
            ),
        ),
        Then('both checks pass and the two test bodies ran at the same time')((s, expect) => {
          const moments: ReadonlyArray<readonly number[]> = s.checked.stamps.map((lines) =>
            lines.map((line) => Number(line.split(' ')[1]))
          )
          const first = moments[0] ?? []
          const second = moments[1] ?? []
          return expect({
            allCompleted: s.checked.results.every((result) => result.status === 'complete'),
            stampCounts: moments.map((times) => times.length),
            bodiesOverlapped: Math.max(first[0] ?? 0, second[0] ?? 0) < Math.min(first[1] ?? 0, second[1] ?? 0),
          }).toEqual({ allCompleted: true, stampCounts: [2, 2], bodiesOverlapped: true })
        }),
      ),
    )

    scenario(
      'A hook declared outside every suite in one file never runs for another file',
      Gherkin.Do.pipe(
        Given('two written suites where only the first declares such a hook')(
          'suites',
          () =>
            writeSuites('hooked', [OUTSIDE_HOOK_SUITE, OUTSIDE_HOOK_VICTIM_SUITE]).pipe(
              Effect.provide(suiteFileLayer),
            ),
        ),
        When('the runner checks both files together before any mutant runs')(
          'outcome',
          (s) =>
            Effect.flatMap(
              runnerFor(s.suites),
              (runner) => runner.dryRun({ timeout: COMPLETION_BUDGET_MS, coverageAnalysis: 'off', disableBail: false }),
            ).pipe(Effect.ensuring(removeSuite(s.suites.directory))),
        ),
        Then('both files pass, so the hook stayed with the file that declared it')((s, expect) =>
          expect({
            completed: s.outcome.status === 'complete',
            testStatuses: s.outcome.status === 'complete' ? s.outcome.tests.map((test) => test.status) : [],
          }).toEqual({ completed: true, testStatuses: ['success', 'success'] })
        ),
      ),
    )

    scenario(
      'The worker a runner starts goes away once the check is done',
      Gherkin.Do.pipe(
        Given('a written suite whose only test passes')(
          'suite',
          () => writeSuite('worker-lifetime', IGNORING_SUITE).pipe(Effect.provide(suiteFileLayer)),
        ),
        When('the runner checks the suite and then stops')(
          'lifetime',
          (s) => workerLifetime(s.suite),
        ),
        Then('the worker the runner started is gone')((s, expect) =>
          expect({
            dryRunStatus: s.lifetime.dryRun.status,
            workerAppeared: s.lifetime.during.length > s.lifetime.before.length,
            workersAfter: s.lifetime.after,
          }).toEqual({
            dryRunStatus: 'complete',
            workerAppeared: true,
            workersAfter: s.lifetime.before,
          })
        ),
      ),
    )
  })
