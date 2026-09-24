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

interface SandboxFileSpec {
  readonly name: string
  readonly source: string
}

const sandboxOf = (
  files: readonly SandboxFileSpec[],
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-concurrency-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
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
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  }).pipe(Effect.ensuring(releaseSandbox(sandbox)))

const withSandbox = (
  files: readonly SandboxFileSpec[],
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> => sandboxOf(files)

const passingNames = (names: ReadonlyArray<string>): ReadonlyArray<SuiteOutcome['results'][number]> =>
  names.map((name) => ({ name, status: 'success', failureMessage: undefined }))

const GATE_FILE: SandboxFileSpec = {
  name: 'gate.test.ts',
  source: [
    "import { expect, test } from 'vitest'",
    '',
    'let opened = false',
    'const gate = Promise.withResolvers<void>()',
    '',
    "test.concurrent('the waiter only proceeds once the opener runs', async () => {",
    '  await gate.promise',
    '  expect(opened).toBe(true)',
    '})',
    '',
    "test.concurrent('the opener runs while the waiter waits', async () => {",
    '  opened = true',
    '  gate.resolve()',
    '})',
    '',
  ].join('\n'),
}

const MIXED_FILE: SandboxFileSpec = {
  name: 'mixed.test.ts',
  source: [
    "import { describe, expect, test } from 'vitest'",
    '',
    "test.concurrent('c1 slow', async () => {",
    '  await Promise.resolve()',
    '  await Promise.resolve()',
    '  expect(1).toBe(1)',
    '})',
    '',
    "test.concurrent('c2 fast', async () => {",
    '  expect(2).toBe(2)',
    '})',
    '',
    "describe.concurrent('block', () => {",
    "  test('d1 slow', async () => {",
    '    await Promise.resolve()',
    '    expect(3).toBe(3)',
    '  })',
    "  test('d2 fast', () => {",
    '    expect(4).toBe(4)',
    '  })',
    '})',
    '',
    "test('tail', () => {",
    '  expect(5).toBe(5)',
    '})',
    '',
  ].join('\n'),
}

const NESTED_FILE: SandboxFileSpec = {
  name: 'nested.test.ts',
  source: [
    "import { describe, expect, test } from 'vitest'",
    '',
    "describe.concurrent('outer', () => {",
    "  test('c-slow', async () => {",
    '    await Promise.resolve()',
    '    expect(1).toBe(1)',
    '  })',
    "  describe('inner', () => {",
    "    test('s1', async () => {",
    '      await Promise.resolve()',
    '      expect(2).toBe(2)',
    '    })',
    "    test('s2', () => {",
    '      expect(3).toBe(3)',
    '    })',
    '  })',
    "  test('c-fast', async () => {",
    '    await Promise.resolve()',
    '    expect(4).toBe(4)',
    '  })',
    '})',
    '',
  ].join('\n'),
}

const peakSource = (expected: number): string =>
  [
    "import { expect, test } from 'vitest'",
    '',
    'let active = 0',
    'let peak = 0',
    'const worker = async (): Promise<void> => {',
    '  active += 1',
    '  if (active > peak) peak = active',
    '  await Promise.resolve()',
    '  await Promise.resolve()',
    '  active -= 1',
    '}',
    '',
    "test.concurrent('w1', worker)",
    "test.concurrent('w2', worker)",
    "test.concurrent('w3', worker)",
    "test.concurrent('w4', worker)",
    "test.concurrent('w5', worker)",
    '',
    "test('the peak stays within the ceiling', () => {",
    `  expect(peak).toBe(${expected})`,
    '})',
    '',
  ].join('\n')

const PEAK_DEFAULT_FILE: SandboxFileSpec = { name: 'peak.test.ts', source: peakSource(5) }

const CEILING_CONFIG: SandboxFileSpec = {
  name: 'vitest.config.ts',
  source: [
    "import { defineConfig } from 'vitest/config'",
    '',
    'export default defineConfig({',
    '  test: {',
    '    maxConcurrency: 1,',
    '  },',
    '})',
    '',
  ].join('\n'),
}

const PEAK_CEILING_FILE: SandboxFileSpec = { name: 'peak.test.ts', source: peakSource(1) }

const ORDER_FILE: SandboxFileSpec = {
  name: 'order.test.ts',
  source: [
    "import { test } from 'vitest'",
    '',
    "test('zebra', () => {",
    '})',
    "test('apple', () => {",
    '})',
    "test('mango', () => {",
    '})',
    '',
  ].join('\n'),
}

const hookSource = (assertion: string): string =>
  [
    "import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'",
    '',
    'const order: Array<string> = []',
    'beforeAll(() => {',
    "  order.push('beforeAll1')",
    '})',
    'beforeAll(() => {',
    "  order.push('beforeAll2')",
    '})',
    'beforeEach(() => {',
    "  order.push('beforeEach1')",
    '})',
    'beforeEach(() => {',
    "  order.push('beforeEach2')",
    '})',
    'afterEach(() => {',
    "  order.push('afterEach1')",
    '})',
    'afterEach(() => {',
    "  order.push('afterEach2')",
    '})',
    'afterAll(() => {',
    "  order.push('afterAll1')",
    '})',
    'afterAll(() => {',
    "  order.push('afterAll2')",
    '})',
    "test('first', () => {",
    "  order.push('first')",
    '})',
    "test('second', () => {",
    "  order.push('second')",
    `  ${assertion}`,
    '})',
    '',
  ].join('\n')

const STACK_ORDER =
  'beforeAll1,beforeAll2,beforeEach1,beforeEach2,first,afterEach2,afterEach1,beforeEach1,beforeEach2,second'
const LIST_ORDER =
  'beforeAll1,beforeAll2,beforeEach1,beforeEach2,first,afterEach1,afterEach2,beforeEach1,beforeEach2,second'

const STACK_HOOKS_FILE: SandboxFileSpec = {
  name: 'hooks.test.ts',
  source: hookSource(`expect(order.join(',')).toBe('${STACK_ORDER}')`),
}

const hooksConfig = (mode: string): SandboxFileSpec => ({
  name: 'vitest.config.ts',
  source: [
    "import { defineConfig } from 'vitest/config'",
    '',
    'export default defineConfig({',
    '  test: {',
    '    sequence: {',
    `      hooks: '${mode}',`,
    '    },',
    '  },',
    '})',
    '',
  ].join('\n'),
})

const LIST_HOOKS_FILE: SandboxFileSpec = {
  name: 'hooks.test.ts',
  source: hookSource(`expect(order.join(',')).toBe('${LIST_ORDER}')`),
}

const PARALLEL_HOOKS_FILE: SandboxFileSpec = {
  name: 'hooks.test.ts',
  source: hookSource(`expect(order.length).toBe(10)`),
}

const CONTEXT_FILE: SandboxFileSpec = {
  name: 'context.test.ts',
  source: [
    "import { expect, test } from 'vitest'",
    '',
    "test.concurrent('ctx passes', async ({ expect: injected }) => {",
    '  injected(1 + 1).toBe(2)',
    '})',
    '',
    "test.concurrent('ctx fails', async ({ expect: injected }) => {",
    '  injected(1).toBe(2)',
    '})',
    '',
    "test.concurrent('imported expect passes', async () => {",
    '  expect(2 * 2).toBe(4)',
    '})',
    '',
  ].join('\n'),
}

const IT_VARIANT_FILE: SandboxFileSpec = {
  name: 'variants.test.ts',
  source: [
    "import { expect, it, test } from 'vitest'",
    '',
    "it.concurrent('ic1', async () => {",
    '  expect(1).toBe(1)',
    '})',
    '',
    "it.concurrent('ic2', async ({ expect: injected }) => {",
    '  injected(2).toBe(2)',
    '})',
    '',
    "test('plain', () => {",
    '  expect(3).toBe(3)',
    '})',
    '',
  ].join('\n'),
}

const SHUFFLE_VARIANT_FILE: SandboxFileSpec = {
  name: 'shuffle.test.ts',
  source: [
    "import { expect, suite, test } from 'vitest'",
    '',
    "suite.shuffle('shuffled', () => {",
    "  test('a', () => {",
    '    expect(3).toBe(3)',
    '  })',
    "  test('b', () => {",
    '    expect(4).toBe(4)',
    '  })',
    '})',
    '',
  ].join('\n'),
}

Feature('Running concurrent suites in memory exactly as Vitest runs them')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .body(({ scenario }) => {
    scenario(
      'Two overlapping tests rendezvous through a shared signal instead of running one after another',
      Gherkin.Do.pipe(
        Given('a suite where one test waits on a signal only its neighbour opens')(
          'sandbox',
          () => withSandbox([GATE_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['gate.test.ts'])),
        Then('both tests pass in declaration order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames([
            'the waiter only proceeds once the opener runs',
            'the opener runs while the waiter waits',
          ]))
        }),
      ),
    )

    scenario(
      'Concurrent tests beside a concurrent block and a trailing sequential test all report in place',
      Gherkin.Do.pipe(
        Given('a file mixing concurrent tests, a concurrent block, and a trailing sequential test')(
          'sandbox',
          () => withSandbox([MIXED_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['mixed.test.ts'])),
        Then('every test passes with its block-qualified name')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames([
            'c1 slow',
            'c2 fast',
            'block > d1 slow',
            'block > d2 fast',
            'tail',
          ]))
        }),
      ),
    )

    scenario(
      'A plain block nested in a concurrent block keeps its tests together',
      Gherkin.Do.pipe(
        Given('a concurrent block holding a plain block between two concurrent tests')(
          'sandbox',
          () => withSandbox([NESTED_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['nested.test.ts'])),
        Then('all four tests pass in declaration order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames([
            'outer > c-slow',
            'outer > inner > s1',
            'outer > inner > s2',
            'outer > c-fast',
          ]))
        }),
      ),
    )

    scenario(
      'Concurrent tests overlap freely under the default ceiling',
      Gherkin.Do.pipe(
        Given('five concurrent workers recording their overlap peak with no configured ceiling')(
          'sandbox',
          () => withSandbox([PEAK_DEFAULT_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['peak.test.ts'])),
        Then('the peak reaches five and every worker passes')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(
            passingNames(['w1', 'w2', 'w3', 'w4', 'w5', 'the peak stays within the ceiling']),
          )
        }),
      ),
    )

    scenario(
      'A ceiling of one serialises the concurrent workers',
      Gherkin.Do.pipe(
        Given('the same workers under a configured concurrency ceiling of one')(
          'sandbox',
          () => withSandbox([CEILING_CONFIG, PEAK_CEILING_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['peak.test.ts'])),
        Then('the peak stays at one and every worker passes')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(
            passingNames(['w1', 'w2', 'w3', 'w4', 'w5', 'the peak stays within the ceiling']),
          )
        }),
      ),
    )

    scenario(
      'Tests run in the order they are declared when no shuffling is configured',
      Gherkin.Do.pipe(
        Given('three tests declared out of alphabetical order')(
          'sandbox',
          () => withSandbox([ORDER_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['order.test.ts'])),
        Then('every test passes in declaration order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['zebra', 'apple', 'mango']))
        }),
      ),
    )

    scenario(
      'Hooks run outermost-first on the way in and innermost-first on the way out by default',
      Gherkin.Do.pipe(
        Given('a suite witnessing its full hook order under the default setting')(
          'sandbox',
          () => withSandbox([STACK_HOOKS_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['hooks.test.ts'])),
        Then('both tests pass against the default order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['first', 'second']))
        }),
      ),
    )

    scenario(
      'Hooks run in declaration order on the way out when configured to list',
      Gherkin.Do.pipe(
        Given('the same suite with hooks configured to run as a list')(
          'sandbox',
          () => withSandbox([hooksConfig('list'), LIST_HOOKS_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['hooks.test.ts'])),
        Then('both tests pass against the listed order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['first', 'second']))
        }),
      ),
    )

    scenario(
      'The parallel setting still runs every hook before the suite finishes',
      Gherkin.Do.pipe(
        Given('the same suite with hooks configured to run in parallel')(
          'sandbox',
          () => withSandbox([hooksConfig('parallel'), PARALLEL_HOOKS_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['hooks.test.ts'])),
        Then('both tests pass and ten hook witnesses ran before the check')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['first', 'second']))
        }),
      ),
    )

    scenario(
      'A concurrent test asserts through the expect handed to it and reports failures verbatim',
      Gherkin.Do.pipe(
        Given('concurrent tests using the injected expect alongside the imported one')(
          'sandbox',
          () => withSandbox([CONTEXT_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['context.test.ts'])),
        Then('the passing tests succeed and the failing one carries the assertion message')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual([
            { name: 'ctx passes', status: 'success', failureMessage: undefined },
            {
              name: 'ctx fails',
              status: 'failed',
              failureMessage: 'expected 1 to be 2 // Object.is equality',
            },
            { name: 'imported expect passes', status: 'success', failureMessage: undefined },
          ])
        }),
      ),
    )

    scenario(
      'The it spelling of a concurrent test behaves like the test spelling',
      Gherkin.Do.pipe(
        Given('concurrent tests declared through the it spelling with injected and imported expects')(
          'sandbox',
          () => withSandbox([IT_VARIANT_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['variants.test.ts'])),
        Then('all three tests pass in declaration order')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['ic1', 'ic2', 'plain']))
        }),
      ),
    )

    scenario(
      'A shuffled block keeps every test and reports them all passing',
      Gherkin.Do.pipe(
        Given('a block declared to shuffle its two tests')(
          'sandbox',
          () => withSandbox([SHUFFLE_VARIANT_FILE]),
        ),
        When('the runner replays the suite')('outcome', (s) => replayOf(s.sandbox, ['shuffle.test.ts'])),
        Then('both tests pass')((s) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          expect(s.outcome.results).toEqual(passingNames(['shuffled > a', 'shuffled > b']))
        }),
      ),
    )
  })
