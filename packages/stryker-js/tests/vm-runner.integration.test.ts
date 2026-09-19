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
}

const NOTICING_SUITE = [
  'const host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>',
  'const stryker: Record<string, unknown> | undefined = host["__stryker__"] as Record<string, unknown> | undefined',
  'const active: unknown = stryker === undefined ? undefined : stryker.activeMutant',
  'if (active === "mutant-1") {',
  '  throw new Error("the mutated program ran")',
  '}',
].join('\n')

const IGNORING_SUITE = 'globalThis.__strykerRun = "completed"'

const MALFORMED_SUITE = 'const broken: = 1'

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

const buildContextFor = (fixture: SuiteFixture): Effect.Effect<TestRunnerBuildContext> =>
  Effect.gen(function*() {
    const defaults = yield* createDefaultOptions
    return {
      options: { ...defaults, testRunner: 'vm' },
      fileDescriptions: {},
      sandboxWorkingDirectory: fixture.directory,
      idGenerator: dummyIdGenerator,
      retire: Effect.void,
      testFiles: [fixture.file],
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
): Effect.Effect<Exit.Exit<DryRunResult, PooledTestRunnerError>, never, never> =>
  Effect.gen(function*() {
    const runner = yield* runnerFor(fixture)
    return yield* runner.dryRun({ timeout: 5000, coverageAnalysis: 'off', disableBail: false }).pipe(Effect.exit)
  }).pipe(Effect.orDie, Effect.ensuring(removeSuite(fixture.directory)))

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
  })
