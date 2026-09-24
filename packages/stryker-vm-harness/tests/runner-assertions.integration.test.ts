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

interface Sandbox {
  readonly root: string
}

interface OutcomeTest {
  readonly name: string
  readonly status: string
  readonly failureMessage: string | undefined
}

interface SuiteOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly results: ReadonlyArray<OutcomeTest>
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
  files: ReadonlyArray<{ readonly name: string; readonly source: string }>,
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-assertions-' })
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
      Effect.promise(() =>
        Session.createVmSession({ sandboxWorkingDirectory: sandbox.root, testFiles }, Session.builtinPlugins)
      ),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  }).pipe(Effect.ensuring(releaseSandbox(sandbox)))

interface SuiteSpec {
  readonly files: ReadonlyArray<{ readonly name: string; readonly source: string }>
  readonly suites: readonly string[]
}

const outcomesOf = (outcome: SuiteOutcome): ReadonlyArray<OutcomeTest> => {
  if (outcome.status !== 'complete') {
    throw new Error(`the replay ended in ${outcome.status}: ${outcome.message ?? 'without a message'}`)
  }
  return outcome.results
}

const SOFT_SUITE: SuiteSpec = {
  files: [
    {
      name: 'soft.test.ts',
      source: `import { expect, test } from 'vitest'

test('a soft failure fails the test without stopping it', () => {
  expect.soft(1).toBe(2)
  expect.soft(3).toBe(3)
})

test('two soft failures are reported by one failed test', () => {
  expect.soft(1).toBe(2)
  expect.soft('a').toBe('b')
})

test('a soft pass beside a hard assertion passes', () => {
  expect.soft(1).toBe(1)
  expect(2).toBe(2)
})
`,
    },
  ],
  suites: ['soft.test.ts'],
}

const SOFT_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'a soft failure fails the test without stopping it',
    status: 'failed',
    failureMessage: 'expected 1 to be 2 // Object.is equality',
  },
  {
    name: 'two soft failures are reported by one failed test',
    status: 'failed',
    failureMessage: 'expected 1 to be 2 // Object.is equality',
  },
  {
    name: 'a soft pass beside a hard assertion passes',
    status: 'success',
    failureMessage: undefined,
  },
]

const ASSERTION_COUNT_SUITE: SuiteSpec = {
  files: [
    {
      name: 'assertions.test.ts',
      source: `import { expect, test } from 'vitest'

test('the planned assertion count passing', () => {
  expect.assertions(2)
  expect(1).toBe(1)
  expect(2).toBe(2)
})

test('the planned assertion count falling short', () => {
  expect.assertions(3)
  expect(1).toBe(1)
})

test('a bare hasAssertions with no assertion', () => {
  expect.hasAssertions()
})

test('a hasAssertions with one assertion', () => {
  expect.hasAssertions()
  expect(1).toBe(1)
})
`,
    },
  ],
  suites: ['assertions.test.ts'],
}

const ASSERTION_COUNT_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'the planned assertion count passing',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'the planned assertion count falling short',
    status: 'failed',
    failureMessage: 'expected number of assertions to be 3, but got 1',
  },
  {
    name: 'a bare hasAssertions with no assertion',
    status: 'failed',
    failureMessage: 'expected any number of assertion, but got none',
  },
  {
    name: 'a hasAssertions with one assertion',
    status: 'success',
    failureMessage: undefined,
  },
]

const MATCHER_SUITE: SuiteSpec = {
  files: [
    {
      name: 'matchers.test.ts',
      source: `import { expect, test } from 'vitest'

expect.extend({
  toBeWithinRange(received: unknown, floor: unknown, ceiling: unknown) {
    const pass =
      typeof received === 'number' &&
      typeof floor === 'number' &&
      typeof ceiling === 'number' &&
      received >= floor &&
      received <= ceiling
    return {
      pass,
      message: () =>
        pass
          ? \`expected \${received} NOT to be within \${floor}..\${ceiling}\`
          : \`expected \${received} to be within \${floor}..\${ceiling}\`,
    }
  },
})

test('a handmade matcher passing', () => {
  expect(50).toBeWithinRange(1, 100)
})

test('a handmade matcher failing with its own message', () => {
  expect(500).toBeWithinRange(1, 100)
})

test('a handmade matcher nested inside an equality', () => {
  expect({ n: 50 }).toEqual({ n: expect.toBeWithinRange(1, 100) })
})

test('a handmade matcher nested inside a failed equality', () => {
  expect({ n: 500 }).toEqual({ n: expect.toBeWithinRange(1, 100) })
})

test('a subset pattern matching', () => {
  expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }))
})

test('a subset pattern missing', () => {
  expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 3 }))
})

test('a membership pattern matching', () => {
  expect([1, 2, 3]).toEqual(expect.arrayContaining([2, 3]))
})

test('a membership pattern missing', () => {
  expect([1, 2]).toEqual(expect.arrayContaining([3]))
})

test('a string pattern matching', () => {
  expect('hello world').toEqual(expect.stringMatching(/wor.d/))
})

test('a string pattern missing', () => {
  expect('hello').toEqual(expect.stringMatching(/xyz/))
})

test('a type pattern matching', () => {
  expect(42).toEqual(expect.any(Number))
})

test('a type pattern crossing types', () => {
  expect('42').toEqual(expect.any(Number))
})

test('a presence pattern on a zero', () => {
  expect(0).toEqual(expect.anything())
})

test('a presence pattern on a null', () => {
  expect(null).toEqual(expect.anything())
})

test('a closeness pattern inside precision', () => {
  expect(0.1 + 0.2).toEqual(expect.closeTo(0.3, 5))
})

test('a closeness pattern far outside precision', () => {
  expect(0.5).toEqual(expect.closeTo(0.3, 5))
})
`,
    },
  ],
  suites: ['matchers.test.ts'],
}

const MATCHER_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'a handmade matcher passing',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a handmade matcher failing with its own message',
    status: 'failed',
    failureMessage: 'expected 500 to be within 1..100',
  },
  {
    name: 'a handmade matcher nested inside an equality',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a handmade matcher nested inside a failed equality',
    status: 'failed',
    failureMessage: 'expected { n: 500 } to deeply equal { n: toBeWithinRange<1, 100> }',
  },
  {
    name: 'a subset pattern matching',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a subset pattern missing',
    status: 'failed',
    failureMessage: 'expected { a: 1, b: 2 } to deeply equal ObjectContaining {"a": 3}',
  },
  {
    name: 'a membership pattern matching',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a membership pattern missing',
    status: 'failed',
    failureMessage: 'expected [ 1, 2 ] to deeply equal ArrayContaining [3]',
  },
  {
    name: 'a string pattern matching',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a string pattern missing',
    status: 'failed',
    failureMessage: "expected 'hello' to deeply equal StringMatching /xyz/",
  },
  {
    name: 'a type pattern matching',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a type pattern crossing types',
    status: 'failed',
    failureMessage: "expected '42' to deeply equal Any<Number>",
  },
  {
    name: 'a presence pattern on a zero',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a presence pattern on a null',
    status: 'failed',
    failureMessage: 'expected null to deeply equal Anything',
  },
  {
    name: 'a closeness pattern inside precision',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a closeness pattern far outside precision',
    status: 'failed',
    failureMessage: 'expected 0.5 to deeply equal NumberCloseTo 0.3 (5 digits)',
  },
]

const THROW_SUITE: SuiteSpec = {
  files: [
    {
      name: 'throws.test.ts',
      source: `import { expect, test } from 'vitest'

const boom = (): never => {
  throw new RangeError('out of bounds')
}

test('any thrown error caught', () => {
  expect(boom).toThrow()
})

test('a thrown message fragment caught', () => {
  expect(boom).toThrow('out of bounds')
})

test('a thrown message pattern caught', () => {
  expect(boom).toThrow(/bounds/)
})

test('a thrown error kind caught', () => {
  expect(boom).toThrow(RangeError)
})

test('the toThrowError spelling caught', () => {
  expect(boom).toThrowError('out of bounds')
})

test('a quiet function reported as not throwing', () => {
  expect(() => 1).toThrow()
})

test('a wrong expected message reported', () => {
  expect(boom).toThrow('nope')
})

test('an unwrapped promised value matching', async () => {
  await expect(Promise.resolve(7)).resolves.toBe(7)
})

test('an unwrapped promised value mismatching', async () => {
  await expect(Promise.resolve(7)).resolves.toBe(8)
})

test('a rejected promised reason caught', async () => {
  await expect(Promise.reject(new Error('bad'))).rejects.toThrow('bad')
})

test('a resolving promise reported as not rejecting', async () => {
  await expect(Promise.resolve(1)).rejects.toBeInstanceOf(Error)
})

test('an untaken unreachable branch passing', () => {
  if (1 !== 1) {
    expect.unreachable()
  }
})

test('a taken unreachable branch reported', () => {
  expect.unreachable()
})
`,
    },
  ],
  suites: ['throws.test.ts'],
}

const THROW_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'any thrown error caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a thrown message fragment caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a thrown message pattern caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a thrown error kind caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'the toThrowError spelling caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a quiet function reported as not throwing',
    status: 'failed',
    failureMessage: 'expected [Function] to throw an error',
  },
  {
    name: 'a wrong expected message reported',
    status: 'failed',
    failureMessage: "expected [Function boom] to throw error including 'nope' but got 'out of bounds'",
  },
  {
    name: 'an unwrapped promised value matching',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'an unwrapped promised value mismatching',
    status: 'failed',
    failureMessage: 'expected 7 to be 8 // Object.is equality',
  },
  {
    name: 'a rejected promised reason caught',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a resolving promise reported as not rejecting',
    status: 'failed',
    failureMessage: 'promise resolved "1" instead of rejecting',
  },
  {
    name: 'an untaken unreachable branch passing',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a taken unreachable branch reported',
    status: 'failed',
    failureMessage: 'expected not to be reached',
  },
]

const CHAI_SUITE: SuiteSpec = {
  files: [
    {
      name: 'chai-types.test.ts',
      source: `import { assert, assertType, expect, expectTypeOf, should, test } from 'vitest'

test('a chai assertion passing', () => {
  assert.strictEqual(1 + 1, 2)
})

test('a chai assertion failing with its message', () => {
  assert.strictEqual(1 + 1, 3)
})

test('prototype helpers staying opt-in', () => {
  expect(typeof should).toBe('function')
  expect(({} as Record<string, unknown>).should).toBeUndefined()
})

test('a compile-time assertion erased at runtime', () => {
  assertType<number>(1)
  expect(1).toBe(1)
})

test('a compile-time type check erased at runtime', () => {
  expectTypeOf(1).toBeNumber()
  expect(2).toBe(2)
})
`,
    },
  ],
  suites: ['chai-types.test.ts'],
}

const CHAI_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'a chai assertion passing',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a chai assertion failing with its message',
    status: 'failed',
    failureMessage: 'expected 2 to equal 3',
  },
  {
    name: 'prototype helpers staying opt-in',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a compile-time assertion erased at runtime',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a compile-time type check erased at runtime',
    status: 'success',
    failureMessage: undefined,
  },
]

const REQUIRE_SUITE: SuiteSpec = {
  files: [
    {
      name: 'require.test.ts',
      source: `import { expect, test } from 'vitest'

test('a suite with an assertion passing', () => {
  expect(1).toBe(1)
})

test('a suite with no assertion failing', () => {})
`,
    },
    {
      name: 'vitest.config.ts',
      source: `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { expect: { requireAssertions: true } },
})
`,
    },
  ],
  suites: ['require.test.ts'],
}

const REQUIRE_OUTCOMES: ReadonlyArray<OutcomeTest> = [
  {
    name: 'a suite with an assertion passing',
    status: 'success',
    failureMessage: undefined,
  },
  {
    name: 'a suite with no assertion failing',
    status: 'failed',
    failureMessage: 'expected any number of assertion, but got none',
  },
]

Feature('Assertion surfaces behave under the in-memory runner exactly as they do under Vitest')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'Soft failures fail the test without stopping its body',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding the soft-failure suite')(
          'sandbox',
          () => sandboxOf(SOFT_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, SOFT_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(SOFT_OUTCOMES)
          })
        ),
      ),
    )

    scenario(
      'Planned assertion counts pass and fail exactly as Vitest decides',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding the assertion-count suite')(
          'sandbox',
          () => sandboxOf(ASSERTION_COUNT_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, ASSERTION_COUNT_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(ASSERTION_COUNT_OUTCOMES)
          })
        ),
      ),
    )

    scenario(
      'Handmade and shape matchers decide exactly as Vitest decides',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding the matcher suite')(
          'sandbox',
          () => sandboxOf(MATCHER_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, MATCHER_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(MATCHER_OUTCOMES)
          })
        ),
      ),
    )

    scenario(
      'Thrown errors, promised outcomes, and dead ends report exactly as Vitest reports',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding the throwing and promised-outcome suite')(
          'sandbox',
          () => sandboxOf(THROW_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, THROW_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(THROW_OUTCOMES)
          })
        ),
      ),
    )

    scenario(
      'Chai assertions and erased type checks run exactly as Vitest runs them',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding the chai and type-check suite')(
          'sandbox',
          () => sandboxOf(CHAI_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, CHAI_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(CHAI_OUTCOMES)
          })
        ),
      ),
    )

    scenario(
      'A project demanding assertions fails a suite that asserts nothing',
      Gherkin.Do.pipe(
        Given('a fresh sandbox holding a project that demands assertions')(
          'sandbox',
          () => sandboxOf(REQUIRE_SUITE.files),
        ),
        When('the runner replays the suite in memory')(
          'outcome',
          (s) => replayOf(s.sandbox, REQUIRE_SUITE.suites),
        ),
        Then('every test carries the status and failure Vitest reports')((s) =>
          Effect.sync(() => {
            expect(outcomesOf(s.outcome)).toEqual(REQUIRE_OUTCOMES)
          })
        ),
      ),
    )
  })
