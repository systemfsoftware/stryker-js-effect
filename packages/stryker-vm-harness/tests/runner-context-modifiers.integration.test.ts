import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path, PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-js/node_modules`
const SUITE_FILE = 'suite.test.ts'
const CONFIG_FILE = 'vitest.config.ts'

interface Sandbox {
  readonly root: string
}

interface ObservedTest {
  readonly name: string
  readonly status: string
  readonly failureMessage: string | undefined
}

interface SuiteOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly tests: ReadonlyArray<ObservedTest>
}

interface ExpectedTest {
  readonly name: string
  readonly status: string
  readonly failureMessage?: string
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
      tests: [],
    }
  }
  return {
    status: response.status,
    message: undefined,
    tests: response.tests.map((test) => ({
      name: test.name,
      status: test.status,
      failureMessage: test.failureMessage,
    })),
  }
}

const assertMatchesVitest = (outcome: SuiteOutcome, expected: ReadonlyArray<ExpectedTest>): void => {
  if (outcome.status !== 'complete') {
    throw new Error(`the replay ended in ${outcome.status}: ${outcome.message ?? 'without a message'}`)
  }
  expect(outcome.tests.map((test) => test.name)).toEqual(expected.map((test) => test.name))
  expect(outcome.tests.map((test) => test.status)).toEqual(expected.map((test) => test.status))
  for (const [index, test] of expected.entries()) {
    if (test.failureMessage !== undefined) {
      expect(outcome.tests[index]?.failureMessage).toBe(test.failureMessage)
    }
  }
}

const sandboxOf = (
  suite: string,
  configFile?: string,
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-context-modifiers-' })
    yield* fileSystem.writeFileString(
      path.join(root, 'package.json'),
      '{\n  "name": "vm-context-modifiers",\n  "private": true,\n  "type": "module"\n}\n',
    )
    yield* fileSystem.writeFileString(path.join(root, SUITE_FILE), suite)
    if (configFile !== undefined) {
      yield* fileSystem.writeFileString(path.join(root, CONFIG_FILE), configFile)
    }
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
    return { root }
  })

const releaseSandbox = (sandbox: Sandbox): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fileSystem) => fileSystem.remove(sandbox.root, { recursive: true, force: true }),
  ).pipe(Effect.orDie)

const replayOf = (
  sandbox: Sandbox,
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    return yield* Effect.acquireUseRelease(
      Effect.promise(() =>
        Session.createVmSession(
          { sandboxWorkingDirectory: sandbox.root, testFiles: [path.join(sandbox.root, SUITE_FILE)] },
          Session.builtinPlugins,
        )
      ),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  }).pipe(Effect.ensuring(releaseSandbox(sandbox)))

const SKIPPED_AND_CONDITIONAL_SUITE = `import { describe, expect, test } from 'vitest'

describe('suite', () => {
  test('normal', () => { expect(1).toBe(1) })
  test.skip('skipped', () => { expect(1).toBe(2) })
  test.skipIf(true)('skipIf true', () => {})
  test.skipIf(false)('skipIf false', () => {})
  test.runIf(true)('runIf true', () => {})
  test.runIf(false)('runIf false', () => {})
  test.todo('todoed')
})

describe.skipIf(true)('skipped suite', () => { test('inside skipped', () => {}) })
describe.runIf(true)('active suite', () => { test('inside active', () => {}) })
describe.runIf(false)('inactive suite', () => { test('inside inactive', () => {}) })
`

const RUNTIME_CONTEXT_SUITE = `import { expect, test } from 'vitest'

test('calls context.skip at runtime', (context) => {
  context.skip('not today')
  expect(1).toBe(2)
})

test('context.skipIf skips', (context) => {
  context.skipIf(true, 'conditional skip')
  expect(1).toBe(2)
})

test('context.skipIf does not skip', (context) => {
  context.skipIf(false, 'conditional skip')
  expect(1).toBe(1)
})
`

const EXCLUSIVE_SUITE = `import { describe, test } from 'vitest'

describe('suite', () => {
  test('normal', () => {})
  test.only('only one', () => {})
})

test('outside', () => {})

describe.only('only suite', () => { test('in only suite', () => {}) })
`

const EXCLUSIVE_SUITE_ONLY = `import { describe, test } from 'vitest'

describe('suite', () => {
  test('normal', () => {})
})

describe.only('only suite', () => { test('in only suite', () => {}) })
`

const ALLOW_ONLY_CONFIG = `export default { test: { allowOnly: true } }
`

const DISALLOW_ONLY_CONFIG = `export default { test: { allowOnly: false } }
`

const TABLE_GENERATED_SUITE = `import { describe, expect, test } from 'vitest'

test.each([1, 2])('each %s', (n) => { expect(typeof n).toBe('number') })
test.for([1, 2])('for %s', (n) => { expect(typeof n).toBe('number') })
test.each([['a', 1], ['b', 2]])('tuple %s %s', (a, b) => {})
test.for([['a', 1]])('for array %s', (item) => { expect(Array.isArray(item)).toBe(true) })
describe.each([1, 2])('desc each %s', () => { test('inside', () => {}) })
describe.for([3])('desc for %s', () => { test('inside for', () => {}) })
`

const DONE_CALLBACK_SUITE = `import { test } from 'vitest'

test('done style', (done) => {
  done()
})
`

const CONTEXT_INSPECTION_ROWS = [
  {
    aspect: 'its own name and metadata',
    suite: `import { expect, test } from 'vitest'

test('task name and meta', (context) => {
  expect(context.task.name).toBe('task name and meta')
  expect(context.task.meta).toEqual({})
})
`,
  },
  {
    aspect: 'a note it attaches',
    suite: `import { expect, test } from 'vitest'

test('annotate', async (context) => {
  await context.annotate('note', 'value')
})
`,
  },
  {
    aspect: 'a signal that has not been aborted',
    suite: `import { expect, test } from 'vitest'

test('signal', (context) => {
  expect(context.signal).toBeInstanceOf(AbortSignal)
  expect(context.signal.aborted).toBe(false)
})
`,
  },
  {
    aspect: 'its built-in members',
    suite: `import { expect, test } from 'vitest'

test('extend-free fields', (context) => {
  expect(typeof context.expect).toBe('function')
  expect(typeof context.skip).toBe('function')
})
`,
  },
] as const

Feature('Test modifiers and the running test context behave under the in-memory runner exactly as under Vitest')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A suite of skipped, conditional and to-do tests reports one outcome for each',
      Gherkin.Do.pipe(
        Given('a suite whose tests are skipped, gated on a condition or left as a to-do')(
          'sandbox',
          () => sandboxOf(SKIPPED_AND_CONDITIONAL_SUITE),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('every test keeps the name and outcome Vitest gives it')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'suite > normal', status: 'success' },
            { name: 'suite > skipped', status: 'skipped' },
            { name: 'suite > skipIf true', status: 'skipped' },
            { name: 'suite > skipIf false', status: 'success' },
            { name: 'suite > runIf true', status: 'success' },
            { name: 'suite > runIf false', status: 'skipped' },
            { name: 'suite > todoed', status: 'skipped' },
            { name: 'skipped suite > inside skipped', status: 'skipped' },
            { name: 'active suite > inside active', status: 'success' },
            { name: 'inactive suite > inside inactive', status: 'skipped' },
          ])
        }),
      ),
    )

    scenario(
      'A running test that changes its own fate is reported the way Vitest reports it',
      Gherkin.Do.pipe(
        Given('a suite whose tests ask to be skipped while they run and reach for a member the context omits')(
          'sandbox',
          () => sandboxOf(RUNTIME_CONTEXT_SUITE),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('the skipped test is reported skipped and the missing member is a plain failure')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'calls context.skip at runtime', status: 'skipped' },
            {
              name: 'context.skipIf skips',
              status: 'failed',
              failureMessage: 'context.skipIf is not a function',
            },
            {
              name: 'context.skipIf does not skip',
              status: 'failed',
              failureMessage: 'context.skipIf is not a function',
            },
          ])
        }),
      ),
    )

    scenario(
      'A suite holding an exclusive test refuses to run while the allow-only setting is off',
      Gherkin.Do.pipe(
        Given('a suite that marks one test and one nested suite as exclusive while the allow-only setting is off')(
          'sandbox',
          () => sandboxOf(EXCLUSIVE_SUITE, DISALLOW_ONLY_CONFIG),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('the exclusive test fails with the refusal Vitest raises and the rest stay unrun')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'suite > normal', status: 'skipped' },
            {
              name: 'suite > only one',
              status: 'failed',
              failureMessage:
                '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error',
            },
            { name: 'outside', status: 'skipped' },
            { name: 'only suite > in only suite', status: 'skipped' },
          ])
        }),
      ),
    )

    scenario(
      'A suite marking only a nested suite as exclusive still runs nothing while the allow-only setting is off',
      Gherkin.Do.pipe(
        Given('a suite whose exclusive mark sits on a nested suite alone while the allow-only setting is off')(
          'sandbox',
          () => sandboxOf(EXCLUSIVE_SUITE_ONLY, DISALLOW_ONLY_CONFIG),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('no test runs, exactly as Vitest leaves them')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'suite > normal', status: 'skipped' },
            { name: 'only suite > in only suite', status: 'skipped' },
          ])
        }),
      ),
    )

    scenario(
      'Once the allow-only setting is on, only the exclusive tests run',
      Gherkin.Do.pipe(
        Given('a suite that marks one test and one nested suite as exclusive, with the allow-only setting switched on')(
          'sandbox',
          () => sandboxOf(EXCLUSIVE_SUITE, ALLOW_ONLY_CONFIG),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('the exclusive test and nested suite run while everything else stays unrun')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'suite > normal', status: 'skipped' },
            { name: 'suite > only one', status: 'success' },
            { name: 'outside', status: 'skipped' },
            { name: 'only suite > in only suite', status: 'success' },
          ])
        }),
      ),
    )

    scenario(
      'Tests and suites generated from a table report the names the generator produces',
      Gherkin.Do.pipe(
        Given('a suite whose tests and nested suites are generated from tables of values')(
          'sandbox',
          () => sandboxOf(TABLE_GENERATED_SUITE),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('every generated test carries the interpolated name Vitest builds')((s) => {
          assertMatchesVitest(s.outcome, [
            { name: 'each 1', status: 'success' },
            { name: 'each 2', status: 'success' },
            { name: 'for 1', status: 'success' },
            { name: 'for 2', status: 'success' },
            { name: 'tuple a 1', status: 'success' },
            { name: 'tuple b 2', status: 'success' },
            { name: 'for array a', status: 'success' },
            { name: 'desc each 1 > inside', status: 'success' },
            { name: 'desc each 2 > inside', status: 'success' },
            { name: 'desc for 3 > inside for', status: 'success' },
          ])
        }),
      ),
    )

    scenarioOutline(
      'A test that inspects <aspect> of its context passes',
      CONTEXT_INSPECTION_ROWS,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a suite whose single test inspects ${row.aspect} of its context`)(
            'sandbox',
            () => sandboxOf(row.suite),
          ),
          When('the runner replays the suite in memory')(
            'outcome',
            (s) => replayOf(s.sandbox),
          ),
          Then('the test is reported as passing, as it passes under Vitest')((s) => {
            assertMatchesVitest(s.outcome, [
              { name: row.suite.match(/test\('([^']+)'/u)?.[1] ?? '', status: 'success' },
            ])
          }),
        ),
    )

    scenario(
      'A test taking a completion callback is rejected the way Vitest rejects it',
      Gherkin.Do.pipe(
        Given('a suite whose single test takes a completion callback and calls it')(
          'sandbox',
          () => sandboxOf(DONE_CALLBACK_SUITE),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox),
        ),
        Then('the test is reported as a failure explaining the callback is not supported')((s) => {
          assertMatchesVitest(s.outcome, [
            {
              name: 'done style',
              status: 'failed',
              failureMessage: 'done() callback is deprecated, use promise instead',
            },
          ])
        }),
      ),
    )
  })
