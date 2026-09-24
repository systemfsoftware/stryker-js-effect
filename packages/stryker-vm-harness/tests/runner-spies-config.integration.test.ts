import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { builtinPlugins, createVmSession, type VmRunResponse } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-js/node_modules`

type ProjectFiles = Readonly<Record<string, string>>

interface TestOutcome {
  readonly name: string
  readonly status: string
  readonly failureMessage: string | undefined
}

interface SuiteOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly results: ReadonlyArray<TestOutcome>
}

const outcomeOf = (response: VmRunResponse): SuiteOutcome => {
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

const sandboxOf = (files: ProjectFiles): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-spies-' })
    for (const name of Object.keys(files)) {
      const content = files[name]
      if (content === undefined) continue
      yield* fileSystem.writeFileString(path.join(root, name), content)
    }
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
    return root
  }).pipe(Effect.orDie)

const releaseSandbox = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fileSystem) => fileSystem.remove(root, { recursive: true, force: true }),
  ).pipe(Effect.orDie)

const replayOf = (root: string, testFile: string): Effect.Effect<SuiteOutcome, never, Path.Path> =>
  Effect.flatMap(Path.Path, (path) =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        createVmSession(
          { sandboxWorkingDirectory: root, testFiles: [path.join(root, testFile)] },
          builtinPlugins,
        )
      ),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    ))

const completeOutcome = (outcome: SuiteOutcome): SuiteOutcome => {
  if (outcome.status !== 'complete') {
    throw new Error(`the replay ended in ${outcome.status}: ${outcome.message ?? 'without a message'}`)
  }
  return outcome
}

const expectOutcome = (
  outcome: SuiteOutcome,
  expected: ReadonlyArray<{ readonly name: string; readonly status: string }>,
): void => {
  const complete = completeOutcome(outcome)
  expect(complete.results.map((test) => ({ name: test.name, status: test.status }))).toStrictEqual(expected)
  expect(complete.results.filter((test) => test.failureMessage !== undefined)).toStrictEqual([])
}

const FN_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.fn records calls and returns configured values', () => {
  const fn = vi.fn((x: number) => x + 1)
  expect(fn(1)).toBe(2)
  expect(fn).toHaveBeenCalledTimes(1)
  fn.mockReturnValue(10)
  expect(fn()).toBe(10)
})
`

const SPY_ON_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.spyOn wraps a method and observes calls while still calling through', () => {
  const obj = { greet: (name: string) => \`hi \${name}\` }
  const spy = vi.spyOn(obj, 'greet')
  expect(obj.greet('a')).toBe('hi a')
  expect(spy).toHaveBeenCalledWith('a')
  spy.mockRestore()
  expect(obj.greet('b')).toBe('hi b')
})
`

const IMPLEMENTATION_ONCE_SUITE = `import { expect, test, vi } from 'vitest'

test('mockImplementationOnce applies once then falls back', () => {
  const fn = vi.fn(() => 'default')
  fn.mockImplementationOnce(() => 'first')
  expect(fn()).toBe('first')
  expect(fn()).toBe('default')
})
`

const RESOLVED_VALUE_SUITE = `import { expect, test, vi } from 'vitest'

test('mockResolvedValue resolves with the given value', async () => {
  const fn = vi.fn()
  fn.mockResolvedValue(42)
  await expect(fn()).resolves.toBe(42)
})
`

const IS_MOCK_FUNCTION_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.isMockFunction distinguishes mocks from plain functions', () => {
  expect(vi.isMockFunction(vi.fn())).toBe(true)
  expect(vi.isMockFunction(() => undefined)).toBe(false)
})
`

const MOCKED_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.mocked returns the same mock instance', () => {
  const fn = vi.fn()
  expect(vi.mocked(fn)).toBe(fn)
})
`

const STUB_GLOBAL_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.stubGlobal replaces a global until unstubbed', () => {
  vi.stubGlobal('__probeGlobal', 'stubbed')
  expect((globalThis as Record<string, unknown>).__probeGlobal).toBe('stubbed')
  vi.unstubAllGlobals()
  expect((globalThis as Record<string, unknown>).__probeGlobal).toBeUndefined()
})
`

const STUB_ENV_SUITE = `import { expect, test, vi } from 'vitest'

test('vi.stubEnv replaces an env value until unstubbed', () => {
  vi.stubEnv('PROBE_ENV', 'stubbed')
  expect(process.env.PROBE_ENV).toBe('stubbed')
  vi.unstubAllEnvs()
  expect(process.env.PROBE_ENV).toBeUndefined()
})
`

const CLEAR_MOCKS_SUITE = `import { expect, test, vi } from 'vitest'

const spy = vi.fn()

test('a call on the shared mock is recorded', () => {
  spy()
  expect(spy).toHaveBeenCalledTimes(1)
})

test('clearMocks cleared the recorded call between tests', () => {
  expect(spy).toHaveBeenCalledTimes(0)
})
`

const MOCK_RESET_SUITE = `import { expect, test, vi } from 'vitest'

const fn = vi.fn()

test('the mock returns its configured implementation', () => {
  fn.mockImplementation(() => 'configured')
  expect(fn()).toBe('configured')
})

test('mockReset returned the implementation to the original between tests', () => {
  expect(fn()).toBeUndefined()
})
`

const RESTORE_MOCKS_SUITE = `import { expect, test, vi } from 'vitest'

const obj = { greet: () => 'original' }

test('a spy replaces the method for this test', () => {
  vi.spyOn(obj, 'greet').mockReturnValue('spied')
  expect(obj.greet()).toBe('spied')
})

test('restoreMocks restored the original method between tests', () => {
  expect(obj.greet()).toBe('original')
})
`

const UNSTUB_GLOBALS_SUITE = `import { expect, test, vi } from 'vitest'

test('a global is stubbed for this test', () => {
  vi.stubGlobal('__cfgGlobal', 'x')
  expect((globalThis as Record<string, unknown>).__cfgGlobal).toBe('x')
})

test('unstubGlobals removed the stub between tests', () => {
  expect((globalThis as Record<string, unknown>).__cfgGlobal).toBeUndefined()
})
`

const UNSTUB_ENVS_SUITE = `import { expect, test, vi } from 'vitest'

test('an env var is stubbed for this test', () => {
  vi.stubEnv('CFG_ENV', 'x')
  expect(process.env.CFG_ENV).toBe('x')
})

test('unstubEnvs removed the stub between tests', () => {
  expect(process.env.CFG_ENV).toBeUndefined()
})
`

const CONFIG_OF = (test: string): string =>
  `import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { ${test} } })
`

type ResetRow = {
  readonly handle: string
  readonly file: string
  readonly suite: string
  readonly config: string
  readonly expected: ReadonlyArray<{ readonly name: string; readonly status: string }>
}

const RESET_ROWS: ReadonlyArray<ResetRow> = [
  {
    handle: 'clears recorded calls between tests',
    file: 'clear-mocks.test.ts',
    suite: CLEAR_MOCKS_SUITE,
    config: CONFIG_OF('clearMocks: true'),
    expected: [
      { name: 'a call on the shared mock is recorded', status: 'success' },
      { name: 'clearMocks cleared the recorded call between tests', status: 'success' },
    ],
  },
  {
    handle: 'resets implementations between tests',
    file: 'mock-reset.test.ts',
    suite: MOCK_RESET_SUITE,
    config: CONFIG_OF('mockReset: true'),
    expected: [
      { name: 'the mock returns its configured implementation', status: 'success' },
      { name: 'mockReset returned the implementation to the original between tests', status: 'success' },
    ],
  },
  {
    handle: 'restores original methods between tests',
    file: 'restore-mocks.test.ts',
    suite: RESTORE_MOCKS_SUITE,
    config: CONFIG_OF('restoreMocks: true'),
    expected: [
      { name: 'a spy replaces the method for this test', status: 'success' },
      { name: 'restoreMocks restored the original method between tests', status: 'success' },
    ],
  },
  {
    handle: 'un-stubs globals between tests',
    file: 'unstub-globals.test.ts',
    suite: UNSTUB_GLOBALS_SUITE,
    config: CONFIG_OF('unstubGlobals: true'),
    expected: [
      { name: 'a global is stubbed for this test', status: 'success' },
      { name: 'unstubGlobals removed the stub between tests', status: 'success' },
    ],
  },
  {
    handle: 'un-stubs environment variables between tests',
    file: 'unstub-envs.test.ts',
    suite: UNSTUB_ENVS_SUITE,
    config: CONFIG_OF('unstubEnvs: true'),
    expected: [
      { name: 'an env var is stubbed for this test', status: 'success' },
      { name: 'unstubEnvs removed the stub between tests', status: 'success' },
    ],
  },
]

Feature("Replaying a project's test doubles in memory exactly as Vitest replays them")
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A mock function records its calls and answers with the value the test asks for',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite exercises a mock function')(
          'sandbox',
          () => sandboxOf({ 'fn.test.ts': FN_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'fn.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              { name: 'vi.fn records calls and returns configured values', status: 'success' },
            ])
          )
        ),
      ),
    )

    scenario(
      'A spy watches an existing method and keeps calling through until it is taken back',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite spies on an existing method')(
          'sandbox',
          () => sandboxOf({ 'spy-on.test.ts': SPY_ON_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'spy-on.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              {
                name: 'vi.spyOn wraps a method and observes calls while still calling through',
                status: 'success',
              },
            ])
          )
        ),
      ),
    )

    scenario(
      'A one-off implementation answers once and then the default takes over',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite queues a single implementation')(
          'sandbox',
          () => sandboxOf({ 'implementation-once.test.ts': IMPLEMENTATION_ONCE_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'implementation-once.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              { name: 'mockImplementationOnce applies once then falls back', status: 'success' },
            ])
          )
        ),
      ),
    )

    scenario(
      'A mock the test awaits resolves with the value it was given',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite awaits a resolving mock')(
          'sandbox',
          () => sandboxOf({ 'resolved-value.test.ts': RESOLVED_VALUE_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'resolved-value.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [{ name: 'mockResolvedValue resolves with the given value', status: 'success' }])
          )
        ),
      ),
    )

    scenario(
      'The runner tells a mock function apart from an ordinary function',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite compares a mock with a plain function')(
          'sandbox',
          () => sandboxOf({ 'is-mock-function.test.ts': IS_MOCK_FUNCTION_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'is-mock-function.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              { name: 'vi.isMockFunction distinguishes mocks from plain functions', status: 'success' },
            ])
          )
        ),
      ),
    )

    scenario(
      'A typed handle to a mock is the very mock the test created',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite asks for a typed handle to its mock')(
          'sandbox',
          () => sandboxOf({ 'mocked.test.ts': MOCKED_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'mocked.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [{ name: 'vi.mocked returns the same mock instance', status: 'success' }])
          )
        ),
      ),
    )

    scenario(
      'A global a test stubs is put back when the test releases it',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite stubs a global and then releases it')(
          'sandbox',
          () => sandboxOf({ 'stub-global.test.ts': STUB_GLOBAL_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'stub-global.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              { name: 'vi.stubGlobal replaces a global until unstubbed', status: 'success' },
            ])
          )
        ),
      ),
    )

    scenario(
      'An environment variable a test stubs is put back when the test releases it',
      Gherkin.Do.pipe(
        Given('a sandbox project whose suite stubs an environment variable and then releases it')(
          'sandbox',
          () => sandboxOf({ 'stub-env.test.ts': STUB_ENV_SUITE }),
        ),
        When('the in-memory runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, 'stub-env.test.ts').pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
        ),
        Then('the test passes with the name Vitest reports')((s) =>
          Effect.sync(() =>
            expectOutcome(s.outcome, [
              { name: 'vi.stubEnv replaces an env value until unstubbed', status: 'success' },
            ])
          )
        ),
      ),
    )

    scenarioOutline(
      'A project that <handle> gives the second test a clean slate',
      RESET_ROWS,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a sandbox project configured to ${row.handle}`)(
            'sandbox',
            () => sandboxOf({ 'vitest.config.ts': row.config, [row.file]: row.suite }),
          ),
          When('the in-memory runner replays the suite')(
            'outcome',
            (s) => replayOf(s.sandbox, row.file).pipe(Effect.ensuring(releaseSandbox(s.sandbox))),
          ),
          Then('both tests pass with the names Vitest reports')((s) =>
            Effect.sync(() => expectOutcome(s.outcome, row.expected))
          ),
          And('neither test reports a failure message')((s) =>
            Effect.sync(() => {
              completeOutcome(s.outcome)
              expect(s.outcome.results.every((test) => test.failureMessage === undefined)).toBe(true)
            })
          ),
        ),
    )
  })
