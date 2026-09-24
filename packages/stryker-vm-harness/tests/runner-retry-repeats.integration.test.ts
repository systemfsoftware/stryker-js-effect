import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path, type PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-js/node_modules`

interface SuiteSpec {
  readonly source: string
  readonly config?: string | undefined
}

interface TestReport {
  readonly name: string
  readonly status: string
  readonly failureMessage: string | undefined
}

interface SuiteOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly results: ReadonlyArray<TestReport>
}

const outcomeOf = (response: Session.VmRunResponse): SuiteOutcome => {
  if (response.status !== 'complete') {
    return {
      status: response.status,
      message: response.status === 'init-failed'
        ? response.message
        : response.status === 'error'
        ? response.errorMessage
        : undefined,
      results: [],
    }
  }
  return {
    status: response.status,
    message: undefined,
    results: response.tests.map((test) => ({
      name: test.name,
      status: test.status,
      failureMessage: test.failureMessage,
    })),
  }
}

const sandboxOf = (
  spec: SuiteSpec,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-retry-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
    if (spec.config !== undefined) {
      yield* fileSystem.writeFileString(path.join(root, 'vitest.config.ts'), spec.config)
    }
    yield* fileSystem.writeFileString(path.join(root, 'suite.test.ts'), spec.source)
    return root
  })

const releaseSandbox = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fileSystem) => fileSystem.remove(root, { recursive: true, force: true }),
  ).pipe(Effect.orDie)

const replayOf = (
  root: string,
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const testFiles = [path.join(root, 'suite.test.ts')]
    return yield* Effect.acquireUseRelease(
      Effect.promise(() =>
        Session.createVmSession({ sandboxWorkingDirectory: root, testFiles }, Session.builtinPlugins)
      ),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  })

const runSuite = (
  spec: SuiteSpec,
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const root = yield* sandboxOf(spec)
    return yield* replayOf(root).pipe(Effect.ensuring(releaseSandbox(root)))
  })

const completed = (outcome: SuiteOutcome): ReadonlyArray<TestReport> => {
  if (outcome.status !== 'complete') {
    throw new Error(`the replay ended in ${outcome.status}: ${outcome.message ?? 'without a message'}`)
  }
  return outcome.results
}

const reportedAs = (outcome: SuiteOutcome): ReadonlyArray<{ name: string; status: string }> =>
  completed(outcome).map((test) => ({ name: test.name, status: test.status }))

const retryOnceThenPass = `import { expect, test } from 'vitest'

let attempts = 0

test('a test that needs three attempts', { retry: 2 }, () => {
  attempts += 1
  expect(attempts).toBe(3)
})
`

const retryNeverPasses = `import { expect, test } from 'vitest'

test('a test that never passes', { retry: 1 }, () => {
  expect(1).toBe(2)
})
`

const configRetry = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    retry: 1,
  },
})
`

const configRetrySuite = `import { expect, test } from 'vitest'

let attempts = 0

test('a test that leans on the project retry', () => {
  attempts += 1
  expect(attempts).toBe(2)
})
`

const configRetryOverrideSuite = `import { expect, test } from 'vitest'

let attempts = 0

test('a test that opts out of the project retry', { retry: 0 }, () => {
  attempts += 1
  expect(attempts).toBe(2)
})
`

const groupRetrySuite = `import { describe, expect, test } from 'vitest'

describe('a group with its own retry', { retry: 2 }, () => {
  let attempts = 0

  test('inherits the group retry', () => {
    attempts += 1
    expect(attempts).toBe(3)
  })
})
`

const repeatsSuite = `import { expect, test } from 'vitest'

let repetitions = 0

test('a repeated test', { repeats: 2 }, () => {
  repetitions += 1
})

test('the repetition count is observable afterwards', () => {
  expect(repetitions).toBe(3)
})
`

const expectedFailureThrows = `import { expect, test } from 'vitest'

test.fails('an expected failure that throws', () => {
  expect(1).toBe(2)
})
`

const expectedFailurePasses = `import { expect, test } from 'vitest'

test.fails('an expected failure that passes', () => {
  expect(1).toBe(1)
})
`

const expectedFailureSoftThrows = `import { expect, test } from 'vitest'

test.fails('an expected failure with a soft assertion', () => {
  expect.soft(1).toBe(2)
})
`

const expectedFailureSoftPasses = `import { expect, test } from 'vitest'

test.fails('an expected failure without a failing assertion', () => {
  expect.soft(1).toBe(1)
})
`

const failureHookSuite = `import { expect, onTestFailed, test } from 'vitest'

const retryCounts: Array<number | undefined> = []
let attempts = 0

test('a test that fails twice before passing', { retry: 2 }, ({ task }) => {
  onTestFailed(() => {
    retryCounts.push(task.result?.retryCount)
  })
  attempts += 1
  expect(attempts).toBe(3)
})

test('the recorded failed attempts', () => {
  expect(retryCounts).toEqual([0, 1])
})
`

const attemptNumberSuite = `import { expect, test } from 'vitest'

let attempts = 0

test('a test that inspects its attempt number', { retry: 1 }, ({ task }) => {
  attempts += 1
  if (attempts === 1) {
    throw new Error('first attempt fails')
  }
  expect(task.result?.retryCount).toBe(1)
})
`

const configRepeats = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    repeats: 2,
  },
})
`

const configRepeatsAlwaysFailsSuite = `import { expect, test } from 'vitest'

const runs: Array<number> = []

test('the body repeats for the configured count', () => {
  runs.push(runs.length)
  expect(runs).toEqual([0, 1, 2])
})

test('the witness counts every repetition', () => {
  expect(runs.length).toBe(3)
})
`

const configRepeatsCollectSuite = `import { expect, test } from 'vitest'

const runs: Array<number> = []

test('the body repeats for the configured count', () => {
  runs.push(runs.length)
  expect(runs).toEqual([0, 1, 2])
})
`

const configRepeatsFirstFailSuite = `import { expect, test } from 'vitest'

let attempts = 0

test('fails on the first repeat only', () => {
  attempts += 1
  expect(attempts).toBeGreaterThan(1)
})

test('how many repeats ran', () => {
  expect(attempts).toBe(3)
})
`

Feature('Reporting retried, repeated and expected-failure tests exactly as Vitest does')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A test that only passes on a later attempt is reported as passing',
      Gherkin.Do.pipe(
        Given('a suite whose only test fails twice before finally passing, allowed two retries')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: retryOnceThenPass }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{ name: 'a test that needs three attempts', status: 'success' }])
        }),
      ),
    )

    scenario(
      'A test that never passes is reported as failing once its retries are exhausted',
      Gherkin.Do.pipe(
        Given('a suite whose only test always fails, allowed one retry')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: retryNeverPasses }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as failing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{ name: 'a test that never passes', status: 'failed' }])
        }),
      ),
    )

    scenario(
      'A test takes its retry allowance from the project configuration',
      Gherkin.Do.pipe(
        Given('a project whose configuration allows one retry, and a suite whose test passes on its second attempt')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: configRetrySuite, config: configRetry }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{ name: 'a test that leans on the project retry', status: 'success' }])
        }),
      ),
    )

    scenario(
      'A retry allowance given to one test overrides the project configuration',
      Gherkin.Do.pipe(
        Given(
          'a project whose configuration allows one retry, and a suite whose test passes on its second attempt but opts out of retries',
        )(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: configRetryOverrideSuite, config: configRetry }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as failing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{
            name: 'a test that opts out of the project retry',
            status: 'failed',
          }])
        }),
      ),
    )

    scenario(
      'A test takes its retry allowance from its enclosing group',
      Gherkin.Do.pipe(
        Given('a suite whose group allows two retries and whose test passes on its third attempt')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: groupRetrySuite }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([
            { name: 'a group with its own retry > inherits the group retry', status: 'success' },
          ])
        }),
      ),
    )

    scenario(
      'A repeated test runs its body once per repetition and is reported as passing',
      Gherkin.Do.pipe(
        Given('a suite whose first test is asked to repeat twice and whose second test counts the runs')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: repeatsSuite }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('both tests are reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([
            { name: 'a repeated test', status: 'success' },
            { name: 'the repetition count is observable afterwards', status: 'success' },
          ])
        }),
      ),
    )

    scenario(
      'An expected failure whose body throws is reported as passing',
      Gherkin.Do.pipe(
        Given('a suite whose only test is expected to fail and whose body throws')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: expectedFailureThrows }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{ name: 'an expected failure that throws', status: 'success' }])
        }),
      ),
    )

    scenario(
      'An expected failure whose body passes is reported as failing',
      Gherkin.Do.pipe(
        Given('a suite whose only test is expected to fail but whose body passes')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: expectedFailurePasses }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as failing, naming the unmet expectation')((s) => {
          expect(completed(s.outcome)).toEqual([
            { name: 'an expected failure that passes', status: 'failed', failureMessage: 'Expect test to fail' },
          ])
        }),
      ),
    )

    scenario(
      'A soft assertion failure satisfies an expected failure',
      Gherkin.Do.pipe(
        Given('a suite whose only test is expected to fail and whose body fails a soft assertion')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: expectedFailureSoftThrows }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([
            { name: 'an expected failure with a soft assertion', status: 'success' },
          ])
        }),
      ),
    )

    scenario(
      'A passing soft assertion does not satisfy an expected failure',
      Gherkin.Do.pipe(
        Given('a suite whose only test is expected to fail and whose body fails no assertion')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: expectedFailureSoftPasses }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as failing, naming the unmet expectation')((s) => {
          expect(completed(s.outcome)).toEqual([
            {
              name: 'an expected failure without a failing assertion',
              status: 'failed',
              failureMessage: 'Expect test to fail',
            },
          ])
        }),
      ),
    )

    scenario(
      'A failure hook sees every unsuccessful attempt while a test retries',
      Gherkin.Do.pipe(
        Given('a suite whose test retries after two failed attempts and records each failed attempt')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: failureHookSuite }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('both tests are reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([
            { name: 'a test that fails twice before passing', status: 'success' },
            { name: 'the recorded failed attempts', status: 'success' },
          ])
        }),
      ),
    )

    scenario(
      'The attempt number is visible to a test that retries',
      Gherkin.Do.pipe(
        Given('a suite whose test retries after a first failed attempt and inspects the attempt number')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: attemptNumberSuite }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([{
            name: 'a test that inspects its attempt number',
            status: 'success',
          }])
        }),
      ),
    )

    scenario(
      'A repeated test configured for the project reports only its first failing repetition',
      Gherkin.Do.pipe(
        Given('a project configured to repeat every test twice and a suite whose body records each run')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: configRepeatsCollectSuite, config: configRepeats }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the test is reported as failing, naming the first failing repetition')((s) => {
          expect(completed(s.outcome)).toEqual([
            {
              name: 'the body repeats for the configured count',
              status: 'failed',
              failureMessage: 'expected [ +0 ] to deeply equal [ +0, 1, 2 ]',
            },
          ])
        }),
      ),
    )

    scenario(
      'A body failing on every repetition still runs all of them and keeps its first failure',
      Gherkin.Do.pipe(
        Given('a project repeating every test twice and a suite whose failing body is watched by a counting witness')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: configRepeatsAlwaysFailsSuite, config: configRepeats }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the failing body keeps its first failing repetition while the witness sees all three runs')((s) => {
          expect(completed(s.outcome)).toEqual([
            {
              name: 'the body repeats for the configured count',
              status: 'failed',
              failureMessage: 'expected [ +0 ] to deeply equal [ +0, 1, 2 ]',
            },
            { name: 'the witness counts every repetition', status: 'success', failureMessage: undefined },
          ])
        }),
      ),
    )

    scenario(
      'A repeated test configured for the project keeps running after a failing repetition',
      Gherkin.Do.pipe(
        Given('a project configured to repeat every test twice and a suite that fails only its first repetition')(
          'suite',
          () => Effect.succeed<SuiteSpec>({ source: configRepeatsFirstFailSuite, config: configRepeats }),
        ),
        When('the in-memory runner replays the suite')('outcome', (s) => runSuite(s.suite)),
        Then('the failing test is reported first and the counting test as passing')((s) => {
          expect(reportedAs(s.outcome)).toEqual([
            { name: 'fails on the first repeat only', status: 'failed' },
            { name: 'how many repeats ran', status: 'success' },
          ])
        }),
        And('the failure names the first failing repetition')((s) => {
          expect(completed(s.outcome)[0]?.failureMessage).toBe('expected 1 to be greater than 1')
        }),
      ),
    )
  })
