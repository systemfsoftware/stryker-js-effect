import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import type { Expect } from '@systemfsoftware/vitest'
import { FileSystem, Path, PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const Feature = makeFeature({ it })

const stripViteFilePrefix = (pathname: string): string =>
  pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname

const NODE_MODULES_LINK_SOURCE = stripViteFilePrefix(
  decodeURIComponent(new URL('../../stryker-js/node_modules', import.meta.url).pathname),
)

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

const projectOf = (
  files: Readonly<Record<string, string>>,
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-timers-' })
    for (const [name, source] of Object.entries(files)) {
      const target = path.join(root, name)
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true })
      yield* fileSystem.writeFileString(target, source)
    }
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(NODE_MODULES_LINK_SOURCE, path.join(root, 'node_modules'))
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
    const testFiles = suites.map((name) => path.join(sandbox.root, 'src', name))
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

const TIMERS_SUITE = `import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

test('advanceTimersByTime fires only the callbacks whose delay has elapsed', () => {
  vi.useFakeTimers()
  const calls: string[] = []
  setTimeout(() => calls.push('a'), 100)
  setTimeout(() => calls.push('b'), 200)
  vi.advanceTimersByTime(150)
  expect(calls).toEqual(['a'])
  vi.advanceTimersByTime(100)
  expect(calls).toEqual(['a', 'b'])
})

test('runAllTimers drains every pending timer', () => {
  vi.useFakeTimers()
  let ticks = 0
  setTimeout(() => {
    ticks++
  }, 10)
  setTimeout(() => {
    ticks++
  }, 10_000)
  vi.runAllTimers()
  expect(ticks).toBe(2)
})

test('a pending fake timer does not fire while only real time passes', () => {
  vi.useFakeTimers()
  let fired = false
  setTimeout(() => {
    fired = true
  }, 5)
  expect(fired).toBe(false)
  expect(vi.getTimerCount()).toBe(1)
})

test('useFakeTimers replaces the clock with fakes', () => {
  vi.useFakeTimers()
  expect(vi.isFakeTimers()).toBe(true)
})
`

const SYSTEM_TIME_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fakeTimers: { toFake: ['Date'] },
  },
})
`

const SYSTEM_TIME_SUITE = `import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

test('setSystemTime pins the clock', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2020-01-02T03:04:05.000Z'))
  expect(Date.now()).toBe(1577934245000)
  expect(new Date().toISOString()).toBe('2020-01-02T03:04:05.000Z')
})

test('only Date is faked when toFake lists Date', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2021-05-06T00:00:00.000Z'))
  expect(vi.isFakeTimers()).toBe(true)
  setTimeout(() => undefined, 1)
  expect(vi.getTimerCount()).toBe(0)
  expect(Date.now()).toBe(1620259200000)
})
`

const PLAIN_SET_SYSTEM_TIME_SUITE = `import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

test('setSystemTime pins the clock', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2020-01-02T03:04:05.000Z'))
  expect(Date.now()).toBe(1577934245000)
  expect(new Date().toISOString()).toBe('2020-01-02T03:04:05.000Z')
})
`

const WAITS_SUITE = `import { expect, test, vi } from 'vitest'

test('waitFor resolves once the assertion holds', async () => {
  let ready = false
  setTimeout(() => {
    ready = true
  }, 20)
  await vi.waitFor(() => {
    expect(ready).toBe(true)
  })
  expect(ready).toBe(true)
})

test('waitFor fails with the last assertion error after the timeout', async () => {
  await vi.waitFor(
    () => {
      expect('never').toBe('always')
    },
    { timeout: 100, interval: 10 },
  )
})

test('waitUntil resolves once the predicate holds', async () => {
  let value = 0
  setTimeout(() => {
    value = 7
  }, 20)
  await vi.waitUntil(() => value === 7)
  expect(value).toBe(7)
})

test('waitUntil times out reporting the interval and timeout', async () => {
  await vi.waitUntil(() => false, { timeout: 100, interval: 10 })
})
`

const POLLING_SUITE = `import { expect, test } from 'vitest'

test('poll resolves once the value matches', async () => {
  let n = 0
  const timer = setInterval(() => {
    n++
  }, 5)
  await expect.poll(() => n, { timeout: 500, interval: 5 }).toBeGreaterThanOrEqual(2)
  clearInterval(timer)
})

test('poll failure reports the polling timeout', async () => {
  await expect.poll(() => 'x', { timeout: 120, interval: 10 }).toBe('y')
})
`

const POLLING_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    expect: { poll: { timeout: 100, interval: 10 } },
  },
})
`

const POLLING_DEFAULTS_SUITE = `import { expect, test } from 'vitest'

test('default poll options time out faster than a custom override', async () => {
  await expect.poll(() => 'x').toBe('y')
}, 10_000)
`

const ISOLATION_FAKE_SUITE = `import { expect, test, vi } from 'vitest'

test('a enables fake timers and never restores the clock', () => {
  vi.useFakeTimers()
  expect(vi.isFakeTimers()).toBe(true)
})
`

const ISOLATION_REAL_SUITE = `import { expect, test, vi } from 'vitest'

test('b starts with the real timers restored', () => {
  expect(vi.isFakeTimers()).toBe(false)
})

test('b advances real time normally', async () => {
  let fired = false
  setTimeout(() => {
    fired = true
  }, 0)
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(() => resolve(), 5)
  await promise
  expect(fired).toBe(true)
})
`

const checkOutcomeOf = (expect: Expect, outcome: SuiteOutcome, expected: SuiteOutcome) =>
  expect(outcome).toEqual(expected)

const failureWith = (name: string, message: string): SuiteOutcome['results'][number] => ({
  name,
  status: 'failed',
  failureMessage: message,
})

const successWith = (name: string): SuiteOutcome['results'][number] => ({
  name,
  status: 'success',
  failureMessage: undefined,
})

Feature('Timer fakes and polling wait for the same outcomes under the in-memory runner')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .live('the sandbox writes real suite files and spawns the in-memory runner over them')
  .body(({ scenario }) => {
    scenario(
      'Scheduled callbacks advance only as the clock moves',
      Gherkin.Do.pipe(
        Given('a suite where two timeouts wait on a fake clock')(
          'sandbox',
          () => projectOf({ 'src/timers.test.ts': TIMERS_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['timers.test.ts']),
        ),
        Then('the in-memory report names the same passing tests as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [
              successWith('advanceTimersByTime fires only the callbacks whose delay has elapsed'),
              successWith('runAllTimers drains every pending timer'),
              successWith('a pending fake timer does not fire while only real time passes'),
              successWith('useFakeTimers replaces the clock with fakes'),
            ],
          })
        }),
      ),
    )

    scenario(
      'The clock stays pinned while only the calendar follows fake time',
      Gherkin.Do.pipe(
        Given('a suite where the runner fakes only the calendar clock')(
          'sandbox',
          () => projectOf({ 'vitest.config.ts': SYSTEM_TIME_CONFIG, 'src/time.test.ts': SYSTEM_TIME_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['time.test.ts']),
        ),
        Then('the in-memory report names the same passing tests as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [
              successWith('setSystemTime pins the clock'),
              successWith('only Date is faked when toFake lists Date'),
            ],
          })
        }),
      ),
    )

    scenario(
      'The clock stays pinned with no runner configuration at all',
      Gherkin.Do.pipe(
        Given('a suite where the clock is pinned with no runner settings')(
          'sandbox',
          () => projectOf({ 'src/time.test.ts': PLAIN_SET_SYSTEM_TIME_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['time.test.ts']),
        ),
        Then('the in-memory report names the same passing test as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [successWith('setSystemTime pins the clock')],
          })
        }),
      ),
    )

    scenario(
      'The runner waits for the condition before reporting the failure',
      Gherkin.Do.pipe(
        Given('a suite where two waits succeed and two time out')(
          'sandbox',
          () => projectOf({ 'src/wait.test.ts': WAITS_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['wait.test.ts']),
        ),
        Then('the in-memory report carries the same names, statuses, and failure wording as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [
              successWith('waitFor resolves once the assertion holds'),
              failureWith(
                'waitFor fails with the last assertion error after the timeout',
                "expected 'never' to be 'always' // Object.is equality",
              ),
              successWith('waitUntil resolves once the predicate holds'),
              failureWith('waitUntil times out reporting the interval and timeout', 'Timed out in waitUntil!'),
            ],
          })
        }),
      ),
    )

    scenario(
      'A polled value resolves once it matches',
      Gherkin.Do.pipe(
        Given('a suite where one poll succeeds and one gives up')(
          'sandbox',
          () => projectOf({ 'src/polling.test.ts': POLLING_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['polling.test.ts']),
        ),
        Then('the in-memory report carries the same names, statuses, and failure wording as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [
              successWith('poll resolves once the value matches'),
              failureWith(
                'poll failure reports the polling timeout',
                "expected 'x' to be 'y' // Object.is equality",
              ),
            ],
          })
        }),
      ),
    )

    scenario(
      'Polling follows the custom waiting limits set on the runner',
      Gherkin.Do.pipe(
        Given('a suite where the runner shortens the polling limits')(
          'sandbox',
          () => projectOf({ 'vitest.config.ts': POLLING_CONFIG, 'src/defaults.test.ts': POLLING_DEFAULTS_SUITE }),
        ),
        When('the runner replays the suite')(
          'outcome',
          (s) => replayOf(s.sandbox, ['defaults.test.ts']),
        ),
        Then('the in-memory report carries the same name, status, and failure wording as Vitest')((s, expect) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return checkOutcomeOf(expect, s.outcome, {
            status: 'complete',
            message: undefined,
            results: [
              failureWith(
                'default poll options time out faster than a custom override',
                "expected 'x' to be 'y' // Object.is equality",
              ),
            ],
          })
        }),
      ),
    )

    scenario(
      'Fake clocks enabled by one suite do not reach the suites around it',
      Gherkin.Do.pipe(
        Given('two suites are written where the first turns every timer fake and never restores the clock')(
          'sandbox',
          () =>
            projectOf({
              'src/fake-a.test.ts': ISOLATION_FAKE_SUITE,
              'src/real-b.test.ts': ISOLATION_REAL_SUITE,
            }),
        ),
        When('the runner replays both suites together')(
          'outcome',
          (s) => replayOf(s.sandbox, ['fake-a.test.ts', 'real-b.test.ts']),
        ),
        Then('the later suite still runs on the real clock, reports the Vitest outcomes, and never saw a fake clock')((
          s,
          expect,
        ) => {
          if (s.outcome.status !== 'complete') {
            throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
          }
          return expect({
            report: s.outcome,
            sawNonSuccessB: s.outcome.results.some((test) => test.name.startsWith('b ') && test.status !== 'success'),
          }).toEqual({
            report: {
              status: 'complete',
              message: undefined,
              results: [
                successWith('a enables fake timers and never restores the clock'),
                successWith('b starts with the real timers restored'),
                successWith('b advances real time normally'),
              ],
            },
            sawNonSuccessB: false,
          })
        }),
      ),
    )
  })
