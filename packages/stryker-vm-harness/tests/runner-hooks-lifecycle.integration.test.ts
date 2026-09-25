import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-js/node_modules`

interface LifecycleSandbox {
  readonly directory: string
  readonly files: readonly string[]
}

const writeSandbox = (
  sources: Readonly<Record<string, string>>,
): Effect.Effect<LifecycleSandbox, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.writeFileString(path.join(directory, 'package.json'), '{"type":"module"}\n')
    yield* fs.symlink(SANDBOX_DEPENDENCIES, path.join(directory, 'node_modules'))
    const files: Array<string> = []
    for (const name of Object.keys(sources)) {
      const target = path.join(directory, name)
      const content = sources[name]
      if (content === undefined) continue
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, content)
      if (name.endsWith('.test.ts')) files.push(target)
    }
    return { directory, files: files.sort() }
  }).pipe(Effect.orDie)

interface ObservedTest {
  readonly name: string
  readonly status: string
  readonly failureMessage: string | undefined
}

const observedOf = (response: Session.VmRunResponse): ReadonlyArray<ObservedTest> => {
  if (response.status !== 'complete') {
    throw new Error(`expected a complete dry run but saw ${response.status}`)
  }
  return response.tests.map((test) => ({
    name: test.name,
    status: test.status,
    failureMessage: test.failureMessage,
  }))
}

const dryRunOf = (
  sandbox: LifecycleSandbox,
): Effect.Effect<ReadonlyArray<ObservedTest>> =>
  Effect.gen(function*() {
    const session = yield* Effect.promise(() =>
      Session.createVmSession(
        { sandboxWorkingDirectory: sandbox.directory, testFiles: [...sandbox.files] },
        Session.builtinPlugins,
      )
    )
    const response = yield* Effect.promise(() =>
      session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })
    )
    yield* Effect.promise(() => session.dispose())
    return observedOf(response)
  })

const fileSource = (lines: ReadonlyArray<string>): string => `${lines.join('\n')}\n`

const orderingSource = fileSource([
  "import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'",
  '',
  'const events: string[] = []',
  '',
  "beforeAll(() => { events.push('root beforeAll') })",
  "afterAll(() => { events.push('root afterAll') })",
  "beforeEach(() => { events.push('root beforeEach') })",
  "afterEach(() => { events.push('root afterEach') })",
  '',
  "describe('outer', () => {",
  "  beforeAll(() => { events.push('outer beforeAll') })",
  "  afterAll(() => { events.push('outer afterAll') })",
  "  beforeEach(() => { events.push('outer beforeEach') })",
  "  afterEach(() => { events.push('outer afterEach') })",
  '',
  "  describe('inner', () => {",
  "    beforeEach(() => { events.push('inner beforeEach') })",
  "    afterEach(() => { events.push('inner afterEach') })",
  '',
  "    test('first sees beforeAll then outer then inner beforeEach', () => {",
  "      expect(events).toEqual(['root beforeAll', 'outer beforeAll', 'root beforeEach', 'outer beforeEach', 'inner beforeEach'])",
  '    })',
  '',
  "    test('second sees the first test cleaned up inner, outer, then root', () => {",
  '      expect(events).toEqual([',
  "        'root beforeAll', 'outer beforeAll', 'root beforeEach', 'outer beforeEach', 'inner beforeEach',",
  "        'inner afterEach', 'outer afterEach', 'root afterEach',",
  "        'root beforeEach', 'outer beforeEach', 'inner beforeEach',",
  '      ])',
  '    })',
  '  })',
  '})',
])

const cleanupSource = fileSource([
  "import { afterEach, beforeEach, describe, expect, test } from 'vitest'",
  '',
  'const events: string[] = []',
  '',
  "describe('beforeEach cleanups', () => {",
  '  beforeEach(() => {',
  "    events.push('outer setup')",
  '    return () => {',
  "      events.push('outer cleanup')",
  '    }',
  '  })',
  '',
  "  describe('inner', () => {",
  '    beforeEach(() => {',
  "      events.push('inner setup')",
  '      return () => {',
  "        events.push('inner cleanup')",
  '      }',
  '    })',
  '',
  "    test('first test leaves both setups recorded', () => {",
  "      expect(events).toEqual(['outer setup', 'inner setup'])",
  '    })',
  '',
  "    test('second test sees cleanups run inner first', () => {",
  '      expect(events).toEqual([',
  "        'outer setup', 'inner setup',",
  "        'inner cleanup', 'outer cleanup',",
  "        'outer setup', 'inner setup',",
  '      ])',
  '    })',
  '  })',
  '})',
  '',
  "describe('afterEach return values are ignored', () => {",
  '  afterEach(() => {',
  "    events.push('after setup')",
  '    return () => {',
  "      events.push('after cleanup')",
  '    }',
  '  })',
  '',
  "  describe('inner', () => {",
  '    afterEach(() => {',
  "      events.push('inner after setup')",
  '      return () => {',
  "        events.push('inner after cleanup')",
  '      }',
  '    })',
  '',
  "    test('first run shows only the earlier suite traffic', () => {",
  '      expect(events).toEqual([',
  "        'outer setup', 'inner setup',",
  "        'inner cleanup', 'outer cleanup',",
  "        'outer setup', 'inner setup',",
  "        'inner cleanup', 'outer cleanup',",
  '      ])',
  '    })',
  '',
  "    test('second run shows hook bodies ran but returned cleanups never did', () => {",
  '      expect(events).toEqual([',
  "        'outer setup', 'inner setup',",
  "        'inner cleanup', 'outer cleanup',",
  "        'outer setup', 'inner setup',",
  "        'inner cleanup', 'outer cleanup', 'inner after setup', 'after setup',",
  '      ])',
  '    })',
  '  })',
  '})',
])

const aroundSource = fileSource([
  "import { aroundAll, aroundEach, describe, expect, test } from 'vitest'",
  '',
  'const events: string[] = []',
  '',
  "describe('root suite wraps everything', () => {",
  '  aroundAll(async (runSuite) => {',
  "    events.push('aroundAll before')",
  '    await runSuite()',
  "    events.push('aroundAll after')",
  '  })',
  '',
  "  describe('aroundEach pins each test', () => {",
  '    aroundEach(async (runTest) => {',
  "      events.push('aroundEach before')",
  '      await runTest()',
  "      events.push('aroundEach after')",
  '    })',
  '',
  "    test('first wrapped test', () => {",
  "      expect(events).toEqual(['aroundAll before', 'aroundEach before'])",
  '    })',
  '',
  "    test('second wrapped test shows nesting order', () => {",
  '      expect(events).toEqual([',
  "        'aroundAll before', 'aroundEach before',",
  "        'aroundEach after', 'aroundEach before',",
  '      ])',
  '    })',
  '  })',
  '',
  "  describe('the wrappers close only after the suite drains', () => {",
  "    test('the closing marks are ready while the last test runs', () => {",
  '      expect(events).toEqual([',
  "        'aroundAll before', 'aroundEach before',",
  "        'aroundEach after', 'aroundEach before',",
  "        'aroundEach after',",
  '      ])',
  '    })',
  '  })',
  '})',
])

const finishedSource = fileSource([
  "import { describe, expect, onTestFailed, onTestFinished, test } from 'vitest'",
  '',
  'const finishedMarks: string[] = []',
  '',
  "describe('finished hooks', () => {",
  "  test('a passing test leaves only the finished mark', () => {",
  "    onTestFinished(() => { finishedMarks.push('context finished') })",
  "    onTestFailed(() => { finishedMarks.push('context failed') })",
  '    expect(finishedMarks).toEqual([])',
  '  })',
  '})',
  '',
  "describe('after the first pass', () => {",
  "  test('only finished ran, never failed', () => {",
  "    expect(finishedMarks).toEqual(['context finished'])",
  '  })',
  '})',
  '',
  "describe('failed hooks', () => {",
  "  test('a failing test fires finished before failed', async () => {",
  '    const late = await import(`vitest`)',
  "    late.onTestFinished(() => { finishedMarks.push('failing finished') })",
  "    late.onTestFailed(() => { finishedMarks.push('failing failed') })",
  "    expect(finishedMarks).toEqual(['context finished'])",
  "    throw new Error('boom')",
  '  })',
  '})',
  '',
  "describe('after the failure', () => {",
  "  test('finished fired for both tests, failed only for the failing one', () => {",
  "    expect(finishedMarks).toEqual(['context finished', 'failing finished', 'failing failed'])",
  '  })',
  '})',
])
const failureTearDownSource = fileSource([
  "import { afterAll, describe, expect, test } from 'vitest'",
  '',
  'const events: string[] = []',
  '',
  'afterAll(() => {',
  "  events.push('root afterAll')",
  '})',
  '',
  "describe('a suite with a failure still tears down', () => {",
  '  afterAll(() => {',
  "    events.push('suite afterAll')",
  '  })',
  '',
  "  test('the failing test', () => {",
  "    events.push('failing test')",
  "    throw new Error('boom')",
  '  })',
  '',
  "  test('the passing test', () => {",
  "    events.push('passing test')",
  '  })',
  '})',
  '',
  "describe('the run continued and tore down', () => {",
  "  test('the suite afterAll ran before the next suite and the root afterAll is still pending', () => {",
  "    expect(events).toEqual(['failing test', 'passing test', 'suite afterAll'])",
  '  })',
  '})',
])

const rootHookFirstSource = fileSource([
  "import { beforeEach, expect, test } from 'vitest'",
  '',
  'beforeEach(() => {',
  '  globalThis.__ROOT_HOOK_COUNT__ = (globalThis.__ROOT_HOOK_COUNT__ ?? 0) + 1',
  '})',
  '',
  "test('first file runs its own root hook once', () => {",
  '  expect(globalThis.__ROOT_HOOK_COUNT__).toBe(1)',
  '})',
])

const rootHookSecondSource = fileSource([
  "import { expect, test } from 'vitest'",
  '',
  "test('second file never saw the first file root hook', () => {",
  '  expect(globalThis.__ROOT_HOOK_COUNT__ ?? 0).toBe(0)',
  '})',
])

const hookFailureSource = fileSource([
  "import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'",
  '',
  "describe('a throwing beforeEach', () => {",
  '  beforeEach(() => {',
  "    throw new Error('beforeEach exploded')",
  '  })',
  '',
  "  test('the first test fails with the hook message', () => {",
  '    expect(true).toBe(true)',
  '  })',
  '',
  "  test('the second test fails with the hook message too', () => {",
  '    expect(true).toBe(true)',
  '  })',
  '})',
  '',
  "describe('a throwing afterEach', () => {",
  '  afterEach(() => {',
  "    throw new Error('afterEach exploded')",
  '  })',
  '',
  "  test('the passing body still fails from the hook', () => {",
  '    expect(true).toBe(true)',
  '  })',
  '})',
  '',
  "describe('a throwing beforeAll', () => {",
  '  beforeAll(() => {',
  "    throw new Error('beforeAll exploded')",
  '  })',
  '',
  "  test('the skipped body never runs its body assertion', () => {",
  '    expect(true).toBe(true)',
  '  })',
  '})',
  '',
  "describe('a throwing afterAll', () => {",
  '  afterAll(() => {',
  "    throw new Error('afterAll exploded')",
  '  })',
  '',
  "  test('the body itself passes', () => {",
  '    expect(true).toBe(true)',
  '  })',
  '})',
])

Feature('Running the hook lifecycle exactly the way Vitest does')
  .withLayer(suiteFileLayer)
  .live('the sandbox writes real suite files and spawns the in-memory runner over them')
  .body(({ scenario }) => {
    scenario(
      'Nested suites run before and after hooks from the outside in and tear down from the inside out',
      Gherkin.Do.pipe(
        Given('a suite that records every hook around two nested tests')(
          'sandbox',
          () => writeSandbox({ 'src/order.test.ts': orderingSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('both tests pass with the full hook order Vitest reports')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'outer > inner > first sees beforeAll then outer then inner beforeEach',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'outer > inner > second sees the first test cleaned up inner, outer, then root',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'A hook that hands back a cleanup runs that cleanup after the test, inside out',
      Gherkin.Do.pipe(
        Given('suites whose beforeEach and afterEach hooks hand back cleanups')(
          'sandbox',
          () => writeSandbox({ 'src/cleanups.test.ts': cleanupSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('every test passes with the cleanup order Vitest reports')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'beforeEach cleanups > inner > first test leaves both setups recorded',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'beforeEach cleanups > inner > second test sees cleanups run inner first',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'afterEach return values are ignored > inner > first run shows only the earlier suite traffic',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name:
                'afterEach return values are ignored > inner > second run shows hook bodies ran but returned cleanups never did',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'Wrapping hooks pin each test and close around the whole suite while it drains',
      Gherkin.Do.pipe(
        Given('a suite wrapped in aroundEach and aroundAll that records every entry and exit')(
          'sandbox',
          () => writeSandbox({ 'src/around.test.ts': aroundSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('each test passes with the wrapper order Vitest reports')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'root suite wraps everything > aroundEach pins each test > first wrapped test',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'root suite wraps everything > aroundEach pins each test > second wrapped test shows nesting order',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name:
                'root suite wraps everything > the wrappers close only after the suite drains > the closing marks are ready while the last test runs',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'Per-test finished and failed hooks fire once with the order Vitest reports',
      Gherkin.Do.pipe(
        Given('tests that register finished and failed hooks around one pass and one failure')(
          'sandbox',
          () => writeSandbox({ 'src/finished.test.ts': finishedSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('the passing test passes, the failing test fails with boom, and the teardown traffic matches Vitest')(
          (s, expect) => {
            return expect(s.observed).toEqual([
              {
                name: 'finished hooks > a passing test leaves only the finished mark',
                status: 'success',
                failureMessage: undefined,
              },
              {
                name: 'after the first pass > only finished ran, never failed',
                status: 'success',
                failureMessage: undefined,
              },
              {
                name: 'failed hooks > a failing test fires finished before failed',
                status: 'failed',
                failureMessage: 'boom',
              },
              {
                name: 'after the failure > finished fired for both tests, failed only for the failing one',
                status: 'success',
                failureMessage: undefined,
              },
            ])
          },
        ),
      ),
    )

    scenario(
      'A failing test still runs the remaining tests and its suites afterAll hooks',
      Gherkin.Do.pipe(
        Given('a suite with one failing test, one passing test, and afterAll hooks')(
          'sandbox',
          () => writeSandbox({ 'src/after-failure.test.ts': failureTearDownSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('the failure fails with boom while the other tests pass with the teardown Vitest reports')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'a suite with a failure still tears down > the failing test',
              status: 'failed',
              failureMessage: 'boom',
            },
            {
              name: 'a suite with a failure still tears down > the passing test',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name:
                'the run continued and tore down > the suite afterAll ran before the next suite and the root afterAll is still pending',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'A hook declared outside every suite stays with its own file',
      Gherkin.Do.pipe(
        Given('two files where only the first declares a root hook')(
          'sandbox',
          () =>
            writeSandbox({
              'src/root-a.test.ts': rootHookFirstSource,
              'src/root-b.test.ts': rootHookSecondSource,
            }),
        ),
        When('the session checks both files together')('observed', (s) => dryRunOf(s.sandbox)),
        Then('both tests pass because no hook leaked across files')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'first file runs its own root hook once',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'second file never saw the first file root hook',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )

    scenario(
      'A throwing hook fails its tests with the hook message while beforeAll skips and afterAll passes',
      Gherkin.Do.pipe(
        Given('suites whose beforeEach, afterEach, beforeAll, and afterAll hooks each throw')(
          'sandbox',
          () => writeSandbox({ 'src/hook-failure.test.ts': hookFailureSource }),
        ),
        When('the session checks the suite')('observed', (s) => dryRunOf(s.sandbox)),
        Then('every outcome matches the status and message Vitest reports')((s, expect) => {
          return expect(s.observed).toEqual([
            {
              name: 'a throwing beforeEach > the first test fails with the hook message',
              status: 'failed',
              failureMessage: 'beforeEach exploded',
            },
            {
              name: 'a throwing beforeEach > the second test fails with the hook message too',
              status: 'failed',
              failureMessage: 'beforeEach exploded',
            },
            {
              name: 'a throwing afterEach > the passing body still fails from the hook',
              status: 'failed',
              failureMessage: 'afterEach exploded',
            },
            {
              name: 'a throwing beforeAll > the skipped body never runs its body assertion',
              status: 'skipped',
              failureMessage: undefined,
            },
            {
              name: 'a throwing afterAll > the body itself passes',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )
  })
