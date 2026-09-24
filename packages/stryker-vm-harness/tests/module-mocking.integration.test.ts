import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { builtinPlugins, createVmSession, type VmRunResponse } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path, PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const FIXTURE_ROOT = `${PACKAGES_ROOT}/stryker-js/testResources/vm-parity/mocking`
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

const sandboxOf = (): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectory({ prefix: 'vm-mocking-' })
    yield* fileSystem.copy(FIXTURE_ROOT, root, { overwrite: true })
    yield* fileSystem.remove(path.join(root, 'node_modules'), { recursive: true, force: true })
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
  suites: readonly string[],
): Effect.Effect<SuiteOutcome, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const testFiles = suites.map((name) => path.join(sandbox.root, 'src', name))
    return yield* Effect.acquireUseRelease(
      Effect.promise(() => createVmSession({ sandboxWorkingDirectory: sandbox.root, testFiles }, builtinPlugins)),
      (session) =>
        Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 120_000, reloadEnvironment: true })).pipe(
          Effect.map(outcomeOf),
        ),
      (session) => Effect.promise(() => session.dispose()),
    )
  }).pipe(Effect.ensuring(releaseSandbox(sandbox)))

const filesOf = (suite: string): readonly string[] =>
  suite === 'isolation' ? ['isolation-a.test.ts', 'isolation-b.test.ts'] : [`${suite}.test.ts`]

Feature('Module mocks behave under the in-memory runner exactly as they do under Vitest')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A suite where <mock> replays with the same passing outcomes in memory',
      [
        { mock: 'a factory supplies the fake implementation', suite: 'factory-mock', tests: 2 },
        { mock: 'a factory keeps the original exports and spies on one', suite: 'original-mock', tests: 1 },
        { mock: 'a module is faked automatically without a factory', suite: 'automock', tests: 4 },
        { mock: 'a module uses the manual fake sitting beside it', suite: 'manual-mock', tests: 1 },
        { mock: 'a fake records calls while keeping the real behaviour', suite: 'spy-mock', tests: 1 },
        { mock: 'a factory reads a value lifted above the imports', suite: 'hoisted-mock', tests: 1 },
        { mock: 'a one-off fake reaches a module loaded on demand', suite: 'do-mock', tests: 2 },
        { mock: 'a test reaches the real module while the suite sees the fake', suite: 'import-actual', tests: 2 },
        { mock: 'a suite asks for the automatic fake directly', suite: 'import-mock', tests: 1 },
        { mock: 'a suite takes back its fake', suite: 'unmock', tests: 1 },
        { mock: 'a suite starts over with fresh module state', suite: 'reset-modules', tests: 1 },
        { mock: 'a fake stays inside the file that created it', suite: 'isolation', tests: 2 },
        { mock: 'a built-in module is faked by a factory', suite: 'builtin-mock', tests: 1 },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('the mocking fixture is copied into a fresh sandbox with its dependencies linked')(
            'sandbox',
            () => sandboxOf(),
          ),
          When(`the runner replays the suite in which ${row.mock}`)(
            'outcome',
            (s) => replayOf(s.sandbox, filesOf(row.suite)),
          ),
          Then('the replay finishes with every test passing')((s) => {
            if (s.outcome.status !== 'complete') {
              throw new Error(`the replay ended in ${s.outcome.status}: ${s.outcome.message ?? 'without a message'}`)
            }
            const failing = s.outcome.results.filter((test) => test.status !== 'success')
            expect(failing).toEqual([])
          }),
          And(`the suite keeps all ${row.tests} of its tests`)((s) => {
            expect(s.outcome.results.map((test) => test.name)).toHaveLength(row.tests)
          }),
        ),
    )
  })
