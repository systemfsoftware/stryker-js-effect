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
  readonly file: string
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

const sandboxOf = (
  source: string,
): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-runner-fixtures-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fileSystem.symlink(SANDBOX_DEPENDENCIES, path.join(root, 'node_modules'))
    const file = path.join(root, 'fixtures.test.ts')
    yield* fileSystem.writeFileString(file, source)
    return { root, file }
  })

const releaseSandbox = (sandbox: Sandbox): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fileSystem) => fileSystem.remove(sandbox.root, { recursive: true, force: true }),
  ).pipe(Effect.orDie)

const replayOf = (
  sandbox: Sandbox,
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      Session.createVmSession(
        { sandboxWorkingDirectory: sandbox.root, testFiles: [sandbox.file] },
        Session.builtinPlugins,
      )
    ),
    (session) =>
      Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 60_000, reloadEnvironment: true })).pipe(
        Effect.map(outcomeOf),
      ),
    (session) => Effect.promise(() => session.dispose()),
  ).pipe(Effect.ensuring(releaseSandbox(sandbox)))

const valuesSuite = `import { expect, test } from 'vitest'

const myTest = test.extend({
  value: 'hello',
  derived: async ({ value }, use) => {
    await use(value + '!')
  },
})

myTest('plain value fixture', ({ value }) => {
  expect(value).toBe('hello')
})

myTest('function fixture derives from another', ({ derived }) => {
  expect(derived).toBe('hello!')
})
`

const autoSuite = `import { expect, test } from 'vitest'

const log = []
const myTest = test.extend('autoValue', { auto: true }, async () => {
  log.push('auto')
  return 'auto'
})

myTest('an auto fixture runs without being requested', () => {
  expect(log).toEqual(['auto'])
})
`

const scopesSuite = `import { expect, test } from 'vitest'

const counts = { test: 0, file: 0, worker: 0 }

const myTest = test
  .extend('perWorker', { scope: 'worker' }, async () => {
    counts.worker += 1
    return 'worker'
  })
  .extend('perFile', { scope: 'file' }, async () => {
    counts.file += 1
    return 'file'
  })
  .extend('perTest', async () => {
    counts.test += 1
    return 'test'
  })

myTest('first test', ({ perTest, perFile, perWorker }) => {
  expect(counts).toEqual({ test: 1, file: 1, worker: 1 })
})

myTest('second test', ({ perTest, perFile, perWorker }) => {
  expect(counts).toEqual({ test: 2, file: 1, worker: 1 })
})
`

const overrideSuite = `import { describe, expect, test } from 'vitest'

const myTest = test.extend({ value: 'base' })

myTest('base value', ({ value }) => {
  expect(value).toBe('base')
})

describe('overridden in a describe', () => {
  myTest.override({ value: 'overridden' })
  myTest('sees the overridden value', ({ value }) => {
    expect(value).toBe('overridden')
  })
})

myTest('outside the describe still sees the base value', ({ value }) => {
  expect(value).toBe('base')
})
`

const scopedSuite = `import { describe, expect, test } from 'vitest'

const myTest = test.extend({ value: 'base' })

myTest('base value', ({ value }) => {
  expect(value).toBe('base')
})

describe('scoped override', () => {
  myTest.scoped({ value: 'scoped' })
  myTest('sees the scoped value', ({ value }) => {
    expect(value).toBe('scoped')
  })
})

myTest('outside the scoped describe', ({ value }) => {
  expect(value).toBe('base')
})
`

const teardownSuite = `import { expect, test } from 'vitest'

const log = []
const myTest = test.extend({
  first: async ({}, use) => {
    log.push('first:in')
    await use('first')
    log.push('first:out')
  },
  second: async ({ first }, use) => {
    log.push('second:in')
    await use('second')
    log.push('second:out')
  },
})

myTest('both set up before the body', ({ second }) => {
  expect(log).toEqual(['first:in', 'second:in'])
})

myTest('both tear down in reverse order', () => {
  expect(log).toEqual(['first:in', 'second:in', 'second:out', 'first:out'])
})
`

const errorSuite = `import { expect, test } from 'vitest'

const myTest = test.extend({
  broken: async ({}, use) => {
    throw new Error('fixture exploded')
  },
})

myTest('a throwing fixture fails the test', ({ broken }) => {
  expect(broken).toBeDefined()
})
`

const aliasSuite = `import { expect, it } from 'vitest'

const myIt = it.extend({ value: 'from-it-extend' })

myIt('it.extend supplies fixtures', ({ value }) => {
  expect(value).toBe('from-it-extend')
})
`

const lazySuite = `import { expect, test } from 'vitest'

let initialised = false

const myTest = test.extend({
  unused: async ({}, use) => {
    initialised = true
    await use('unused')
  },
  used: async ({}, use) => {
    await use('used')
  },
})

myTest('only destructured fixtures are initialised', ({ used }) => {
  expect(used).toBe('used')
  expect(initialised).toBe(false)
})
`

const contextSuite = `import { expect, test } from 'vitest'

const myTest = test.extend({ value: 'v' })

myTest('the callback context carries fixtures and the task', (context) => {
  expect(context.value).toBe('v')
  expect(context.task.name).toBe('the callback context carries fixtures and the task')
})
`

const FIXTURE_CASES = [
  {
    behaviour: 'a held value and a value derived from it reach the tests that ask for them',
    source: valuesSuite,
    expected: [
      { name: 'plain value fixture', status: 'success' },
      { name: 'function fixture derives from another', status: 'success' },
    ],
  },
  {
    behaviour: 'an automatic fixture is set up even though no test asks for it',
    source: autoSuite,
    expected: [{ name: 'an auto fixture runs without being requested', status: 'success' }],
  },
  {
    behaviour: 'a worker fixture and a file fixture are set up once while a test fixture is set up per test',
    source: scopesSuite,
    expected: [
      { name: 'first test', status: 'success' },
      { name: 'second test', status: 'success' },
    ],
  },
  {
    behaviour: 'a block overrides a fixture value for the tests it contains',
    source: overrideSuite,
    expected: [
      { name: 'base value', status: 'success' },
      { name: 'overridden in a describe > sees the overridden value', status: 'success' },
      { name: 'outside the describe still sees the base value', status: 'success' },
    ],
  },
  {
    behaviour: 'a deprecated scoped override applies only inside its block',
    source: scopedSuite,
    expected: [
      { name: 'base value', status: 'success' },
      { name: 'scoped override > sees the scoped value', status: 'success' },
      { name: 'outside the scoped describe', status: 'success' },
    ],
  },
  {
    behaviour: 'fixtures tear down in reverse order after the test body finishes',
    source: teardownSuite,
    expected: [
      { name: 'both set up before the body', status: 'success' },
      { name: 'both tear down in reverse order', status: 'success' },
    ],
  },
  {
    behaviour: 'a fixture that throws is reported as a failing test',
    source: errorSuite,
    expected: [{ name: 'a throwing fixture fails the test', status: 'failed', failureMessage: 'fixture exploded' }],
  },
  {
    behaviour: 'the test alias extends fixtures just like the test function',
    source: aliasSuite,
    expected: [{ name: 'it.extend supplies fixtures', status: 'success' }],
  },
  {
    behaviour: 'only the fixtures a test destructures are set up',
    source: lazySuite,
    expected: [{ name: 'only destructured fixtures are initialised', status: 'success' }],
  },
  {
    behaviour: 'a test whose callback does not destructure its arguments is reported as failing',
    source: contextSuite,
    expected: [{
      name: 'the callback context carries fixtures and the task',
      status: 'failed',
      failureMessage:
        'The 1st argument inside a fixture must use object destructuring pattern, e.g. ({ task } => {}). Instead, received "context".',
    }],
  },
] as const

Feature('Replaying Vitest fixture suites in memory with the same outcomes')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A suite in which <behaviour> replays with the same outcomes Vitest gives',
      FIXTURE_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a sandbox holds the suite with its dependencies linked')(
            'sandbox',
            () => sandboxOf(row.source),
          ),
          When('the in-memory runner replays the suite')('outcome', (s) => replayOf(s.sandbox)),
          Then('every test reports the outcome real Vitest gives')((s) => {
            if (s.outcome.status !== 'complete') {
              throw new Error(
                `the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`,
              )
            }
            expect(s.outcome.results).toEqual(row.expected)
          }),
        ),
    )
  })
