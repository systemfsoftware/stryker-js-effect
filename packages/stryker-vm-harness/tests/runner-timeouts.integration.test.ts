import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { builtinPlugins, createVmSession, type VmRunResponse } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path, PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-js/node_modules`

const RUN_TIMEOUT_MS = 30_000

interface SandboxFileSpec {
  readonly name: string
  readonly source: string
}

interface Sandbox {
  readonly root: string
}

interface SuiteOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly results: ReadonlyArray<{
    readonly name: string
    readonly status: string
    readonly failureMessage: string | undefined
  }>
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

const sandboxOf = (
  files: readonly SandboxFileSpec[],
  config: string | undefined,
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-timeouts-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
    if (config !== undefined) {
      yield* fileSystem.writeFileString(path.join(root, 'vitest.config.ts'), config)
    }
    yield* fileSystem.makeDirectory(path.join(root, 'src'), { recursive: true })
    for (const file of files) {
      yield* fileSystem.writeFileString(path.join(root, file.name), file.source)
    }
    return { root }
  })

const releaseSandbox = (sandbox: Sandbox): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fileSystem) => fileSystem.remove(sandbox.root, { recursive: true, force: true }),
  ).pipe(Effect.orDie)

const replayOf = (
  sandbox: Sandbox,
  suites: readonly string[],
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const testFiles = suites.map((name) => path.join(sandbox.root, name))
    return yield* Effect.acquireUseRelease(
      Effect.promise(() => createVmSession({ sandboxWorkingDirectory: sandbox.root, testFiles }, builtinPlugins)),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: RUN_TIMEOUT_MS, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  }).pipe(Effect.ensuring(releaseSandbox(sandbox)))

const hangSourceOf = (timeout: number): string =>
  [
    'const { promise, resolve } = Promise.withResolvers<void>()',
    `setTimeout(resolve, ${timeout * 10})`,
    'await promise',
  ].join('\n')

const timeoutSuiteOf = (declaration: string, timeout: number): string =>
  [
    "import { expect, test } from 'vitest'",
    '',
    `test('a test that declares its timeout ${declaration}', async () => {`,
    ...hangSourceOf(timeout).split('\n').map((line) => `  ${line}`),
    `}, ${timeout})`,
    '',
    "test('a later test still runs', () => {",
    '  expect(1).toBe(1)',
    '})',
  ].join('\n')

const BARE_NUMBER_TIMEOUT = 50
const OPTIONS_OBJECT_TIMEOUT = 60
const DESCRIBE_TIMEOUT = 70

const OPTIONS_OBJECT_SUITE = [
  "import { expect, test } from 'vitest'",
  '',
  "test('a test that declares its timeout in an options object', { timeout: 60 }, async () => {",
  ...hangSourceOf(OPTIONS_OBJECT_TIMEOUT).split('\n').map((line) => `  ${line}`),
  '})',
  '',
  "test('a later test still runs', () => {",
  '  expect(1).toBe(1)',
  '})',
].join('\n')

const DESCRIBE_SUITE = [
  "import { describe, expect, test } from 'vitest'",
  '',
  "describe('a describe block with a timeout', { timeout: 70 }, () => {",
  "  test('a child inherits the timeout', async () => {",
  ...hangSourceOf(DESCRIBE_TIMEOUT).split('\n').map((line) => `    ${line}`),
  '  })',
  '',
  "  test('a later child still runs', () => {",
  '    expect(1).toBe(1)',
  '  })',
  '})',
].join('\n')

const HOOK_TIMEOUT = 60

const AFTER_EACH_SUITE = [
  "import { afterEach, expect, test } from 'vitest'",
  '',
  'afterEach(async () => {',
  ...hangSourceOf(HOOK_TIMEOUT).split('\n').map((line) => `  ${line}`),
  `}, ${HOOK_TIMEOUT})`,
  '',
  "test('the first test the hook guards', () => {",
  '  expect(1).toBe(1)',
  '})',
  '',
  "test('the second test the hook guards', () => {",
  '  expect(2).toBe(2)',
  '})',
].join('\n')

const BEFORE_ALL_SUITE = [
  "import { beforeAll, expect, test } from 'vitest'",
  '',
  'beforeAll(async () => {',
  ...hangSourceOf(HOOK_TIMEOUT).split('\n').map((line) => `  ${line}`),
  `}, ${HOOK_TIMEOUT})`,
  '',
  "test('a test that never starts', () => {",
  '  expect(1).toBe(1)',
  '})',
  '',
  "test('another test that never starts', () => {",
  '  expect(2).toBe(2)',
  '})',
].join('\n')

const SIGNAL_TIMEOUT = 80

const SIGNAL_SUITE = [
  "import { afterEach, expect, test } from 'vitest'",
  '',
  'let seen: string | undefined',
  '',
  'afterEach(() => {',
  "  expect(seen).toBe('aborted')",
  '})',
  '',
  "test('a test that waits on its cancellation signal', async ({ signal }) => {",
  '  const { promise, resolve } = Promise.withResolvers<void>()',
  "  signal.addEventListener('abort', () => {",
  "    seen = 'aborted'",
  '    resolve()',
  '  }, { once: true })',
  '  setTimeout(resolve, 400)',
  '  await promise',
  "  expect(seen).toBe('aborted')",
  `}, ${SIGNAL_TIMEOUT})`,
].join('\n')

const CONFIG_TEST_TIMEOUT = 70

const CONFIG_TEST_SUITE = [
  "import { expect, test } from 'vitest'",
  '',
  "test('a test with no timeout of its own', async () => {",
  ...hangSourceOf(CONFIG_TEST_TIMEOUT).split('\n').map((line) => `  ${line}`),
  '})',
].join('\n')

const CONFIG_TEST_CONFIG = [
  "import { defineConfig } from 'vitest/config'",
  '',
  'export default defineConfig({',
  `  test: { testTimeout: ${CONFIG_TEST_TIMEOUT} },`,
  '})',
].join('\n')

const CONFIG_HOOK_TIMEOUT = 60

const CONFIG_HOOK_SUITE = [
  "import { beforeEach, expect, test } from 'vitest'",
  '',
  'beforeEach(async () => {',
  ...hangSourceOf(CONFIG_HOOK_TIMEOUT).split('\n').map((line) => `  ${line}`),
  '})',
  '',
  "test('a test whose hook has no timeout of its own', () => {",
  '  expect(1).toBe(1)',
  '})',
].join('\n')

const CONFIG_HOOK_CONFIG = [
  "import { defineConfig } from 'vitest/config'",
  '',
  'export default defineConfig({',
  `  test: { hookTimeout: ${CONFIG_HOOK_TIMEOUT} },`,
  '})',
].join('\n')

const TEST_TEST_TIMEOUT_HINT =
  'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".'
const HOOK_TEST_TIMEOUT_HINT =
  'If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".'

const testTimeoutMessageOf = (timeout: number): string => `Test timed out in ${timeout}ms.\n${TEST_TEST_TIMEOUT_HINT}`

const hookTimeoutMessageOf = (timeout: number): string => `Hook timed out in ${timeout}ms.\n${HOOK_TEST_TIMEOUT_HINT}`

Feature('The in-memory runner reports timeouts exactly as Vitest does')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A test that overruns a timeout declared on the test itself fails with the timeout message',
      [
        {
          declaration: 'declared as a bare number',
          file: 'bare-number.test.ts',
          source: timeoutSuiteOf('as a bare number', BARE_NUMBER_TIMEOUT),
          timedOut: 'a test that declares its timeout as a bare number',
          timeout: BARE_NUMBER_TIMEOUT,
        },
        {
          declaration: 'declared in an options object',
          file: 'options-object.test.ts',
          source: OPTIONS_OBJECT_SUITE,
          timedOut: 'a test that declares its timeout in an options object',
          timeout: OPTIONS_OBJECT_TIMEOUT,
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a suite with a test that outlasts the timeout ${row.declaration}`)(
            'sandbox',
            () => sandboxOf([{ name: `src/${row.file}`, source: row.source }], undefined),
          ),
          When('the runner replays the suite')(
            'outcome',
            (s) => replayOf(s.sandbox, [`src/${row.file}`]),
          ),
          Then('the slow test fails with the exact timeout message and a later test still passes')((s) => {
            if (s.outcome.status !== 'complete') {
              throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
            }
            expect(s.outcome.results).toEqual([
              {
                name: row.timedOut,
                status: 'failed',
                failureMessage: testTimeoutMessageOf(row.timeout),
              },
              {
                name: 'a later test still runs',
                status: 'success',
                failureMessage: undefined,
              },
            ])
          }),
        ),
    )

    scenario(
      'A child that inherits its timeout from its describe block fails with the timeout message',
      Gherkin.Do.pipe(
        Given('a suite nested in a describe block with a timeout')(
          'sandbox',
          () => sandboxOf([{ name: 'src/describe-timeout.test.ts', source: DESCRIBE_SUITE }], undefined),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['src/describe-timeout.test.ts']),
        ),
        Then('the slow child fails with the exact timeout message and a later sibling still passes')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual([
            {
              name: 'a describe block with a timeout > a child inherits the timeout',
              status: 'failed',
              failureMessage: testTimeoutMessageOf(DESCRIBE_TIMEOUT),
            },
            {
              name: 'a describe block with a timeout > a later child still runs',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'A hook that overruns its timeout fails every test it guards',
      Gherkin.Do.pipe(
        Given('a suite whose cleanup hook never finishes in time')(
          'sandbox',
          () => sandboxOf([{ name: 'src/guard-hook.test.ts', source: AFTER_EACH_SUITE }], undefined),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['src/guard-hook.test.ts']),
        ),
        Then('both guarded tests fail with the exact hook message')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual([
            {
              name: 'the first test the hook guards',
              status: 'failed',
              failureMessage: hookTimeoutMessageOf(HOOK_TIMEOUT),
            },
            {
              name: 'the second test the hook guards',
              status: 'failed',
              failureMessage: hookTimeoutMessageOf(HOOK_TIMEOUT),
            },
          ])
        }),
      ),
    )

    scenario(
      'A setup hook that never finishes leaves the tests skipped',
      Gherkin.Do.pipe(
        Given('a suite whose setup hook never finishes in time')(
          'sandbox',
          () => sandboxOf([{ name: 'src/setup-hook.test.ts', source: BEFORE_ALL_SUITE }], undefined),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['src/setup-hook.test.ts']),
        ),
        Then('the tests that never started are reported as skipped')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual([
            { name: 'a test that never starts', status: 'skipped', failureMessage: undefined },
            { name: 'another test that never starts', status: 'skipped', failureMessage: undefined },
          ])
        }),
      ),
    )

    scenario(
      'A test that waits on its cancellation signal still fails with the timeout message',
      Gherkin.Do.pipe(
        Given('a suite whose test waits on its cancellation signal past its timeout')(
          'sandbox',
          () => sandboxOf([{ name: 'src/cancel-signal.test.ts', source: SIGNAL_SUITE }], undefined),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['src/cancel-signal.test.ts']),
        ),
        Then('the waiting test fails with the exact timeout message and nothing else fails')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual([{
            name: 'a test that waits on its cancellation signal',
            status: 'failed',
            failureMessage: testTimeoutMessageOf(SIGNAL_TIMEOUT),
          }])
        }),
      ),
    )

    scenarioOutline(
      'A timeout from the project configuration <scope> without a timeout of its own',
      [
        {
          scope: 'stops a test',
          file: 'config-test-timeout.test.ts',
          source: CONFIG_TEST_SUITE,
          config: CONFIG_TEST_CONFIG,
          name: 'a test with no timeout of its own',
          failureMessage: testTimeoutMessageOf(CONFIG_TEST_TIMEOUT),
        },
        {
          scope: 'stops a hook',
          file: 'config-hook-timeout.test.ts',
          source: CONFIG_HOOK_SUITE,
          config: CONFIG_HOOK_CONFIG,
          name: 'a test whose hook has no timeout of its own',
          failureMessage: hookTimeoutMessageOf(CONFIG_HOOK_TIMEOUT),
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a project whose configuration ${row.scope}`)(
            'sandbox',
            () => sandboxOf([{ name: `src/${row.file}`, source: row.source }], row.config),
          ),
          When('the runner replays the suite')(
            'outcome',
            (s) => replayOf(s.sandbox, [`src/${row.file}`]),
          ),
          Then('the run fails with the exact configured timeout message')((s) => {
            if (s.outcome.status !== 'complete') {
              throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
            }
            expect(s.outcome.results).toEqual([{
              name: row.name,
              status: 'failed',
              failureMessage: row.failureMessage,
            }])
          }),
        ),
    )
  })
