import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const stripViteFilePrefix = (pathname: string): string =>
  pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname

const NODE_MODULES_LINK_SOURCE = stripViteFilePrefix(
  decodeURIComponent(new URL('../../stryker-js/node_modules', import.meta.url).pathname),
)

type ProjectFiles = Readonly<Record<string, string>>

const createProject = (
  files: ProjectFiles,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    for (const name of Object.keys(files)) {
      const content = files[name]
      if (content === undefined) continue
      const target = path.join(root, name)
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, content)
    }
    yield* fs.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fs.symlink(NODE_MODULES_LINK_SOURCE, path.join(root, 'node_modules'))
    return root
  }).pipe(Effect.orDie)

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(root, { recursive: true })
  }).pipe(Effect.orDie)

const runFiles = (root: string, files: readonly string[]): Effect.Effect<Session.VmRunResponse> =>
  Effect.gen(function*() {
    const session = yield* Effect.promise(() =>
      Session.createVmSession({ sandboxWorkingDirectory: root, testFiles: files.map((file) => `${root}/${file}`) })
    )
    return yield* Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })).pipe(
      Effect.ensuring(Effect.promise(() => session.dispose())),
    )
  })

const runFilesAndRelease = (
  root: string,
  files: readonly string[],
): Effect.Effect<Session.VmRunResponse, never, FileSystem.FileSystem> =>
  runFiles(root, files).pipe(Effect.ensuring(removeProject(root)))

const completedTestsOf = (response: Session.VmRunResponse): ReadonlyArray<Session.VmTestResult> => {
  if (response.status !== 'complete') {
    throw new Error(`expected a completed run, saw ${response.status}`)
  }
  return response.tests
}

const outcomeOf = (
  tests: ReadonlyArray<Session.VmTestResult>,
): ReadonlyArray<{ readonly status: string; readonly failureMessage: string | undefined }> =>
  tests.map((test) => ({ status: test.status, failureMessage: test.failureMessage }))

const noSuiteNamesOf = (
  response: Session.VmRunResponse,
): ReadonlyArray<string> =>
  completedTestsOf(response).map((test) => test.name).filter((name) => name.endsWith(' (no test suite)'))

const noSuiteResultOf = (response: Session.VmRunResponse, file: string): Session.VmTestResult => {
  const found = completedTestsOf(response).find((test) => test.name === `${file} (no test suite)`)
  if (found === undefined) {
    throw new Error(`no empty-suite result for ${file} in ${noSuiteNamesOf(response).join(', ')}`)
  }
  return found
}

const EMPTY_IN_SOURCE_FILE = `export const shared = 1

if (import.meta.vitest) {
  // mentions import.meta.vitest but registers no tests
}
`

const populatedTestOf = (name: string): string =>
  `import { expect, test } from 'vitest'

test('${name}', () => {
  expect(1).toBe(1)
})
`

const flagBearingConfig = (flag: string): string =>
  `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: ['src/**/*.ts'],
    ${flag}
  },
})
`

const FLAG_SET_CONFIG = flagBearingConfig('passWithNoTests: true,')
const FLAG_UNSET_CONFIG = flagBearingConfig('')

const WORKSPACE_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'alpha',
          include: ['alpha/*.test.ts'],
          includeSource: ['alpha/src/**/*.ts'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'beta',
          include: ['beta/*.test.ts'],
          includeSource: ['beta/src/**/*.ts'],
        },
      },
    ],
  },
})
`

Feature('Honouring passWithNoTests for files that register no tests')
  .withLayer(suiteFileLayer)
  .live('the sandbox writes real project files and runs a real Vitest session over them')
  .body(({ scenario }) => {
    scenario(
      'A flag-bearing project reports no failure for an in-source file with no tests',
      Gherkin.Do.pipe(
        Given(
          'a project whose config sets passWithNoTests and whose source mentions import.meta.vitest without registering tests',
        )(
          'project',
          () =>
            createProject({
              'vitest.config.ts': FLAG_SET_CONFIG,
              'src/empty.ts': EMPTY_IN_SOURCE_FILE,
              'real.test.ts': populatedTestOf('the real suite still runs'),
            }),
        ),
        When('the dry run covers the empty source file and the real test file')(
          'response',
          (s) => runFilesAndRelease(s.project, ['src/empty.ts', 'real.test.ts']),
        ),
        Then('the run completes with the real test alone and no empty-suite failure')((s, expect) =>
          expect({
            status: s.response.status,
            outcomes: outcomeOf(completedTestsOf(s.response)),
            noSuiteNames: noSuiteNamesOf(s.response),
          }).toEqual({
            status: 'complete',
            outcomes: [{ status: 'success', failureMessage: undefined }],
            noSuiteNames: [],
          })
        ),
      ),
    )

    scenario(
      'A project without the flag fails its empty in-source file',
      Gherkin.Do.pipe(
        Given(
          'a project whose config leaves passWithNoTests unset and whose source mentions import.meta.vitest without registering tests',
        )(
          'project',
          () =>
            createProject({
              'vitest.config.ts': FLAG_UNSET_CONFIG,
              'src/empty.ts': EMPTY_IN_SOURCE_FILE,
              'real.test.ts': populatedTestOf('the real suite still runs'),
            }),
        ),
        When('the dry run covers the empty source file and the real test file')(
          'response',
          (s) => runFilesAndRelease(s.project, ['src/empty.ts', 'real.test.ts']),
        ),
        Then('the empty file fails with Vitest no-test-suite message')((s, expect) => {
          const emptySuite = noSuiteResultOf(s.response, `${s.project}/src/empty.ts`)
          return expect({ status: s.response.status, emptySuite: outcomeOf([emptySuite]) }).toEqual({
            status: 'complete',
            emptySuite: [{ status: 'failed', failureMessage: `No test suite found in file ${s.project}/src/empty.ts` }],
          })
        }),
      ),
    )

    scenario(
      'Each project of a workspace honours its own flag',
      Gherkin.Do.pipe(
        Given('a workspace where only the alpha project sets passWithNoTests')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': WORKSPACE_CONFIG,
              'alpha/src/empty.ts': EMPTY_IN_SOURCE_FILE,
              'alpha/real.test.ts': populatedTestOf('the alpha suite runs'),
              'beta/src/empty.ts': EMPTY_IN_SOURCE_FILE,
              'beta/real.test.ts': populatedTestOf('the beta suite runs'),
            }),
        ),
        When('the dry run covers every file of both projects')(
          'response',
          (s) =>
            runFilesAndRelease(s.project, [
              'alpha/src/empty.ts',
              'alpha/real.test.ts',
              'beta/src/empty.ts',
              'beta/real.test.ts',
            ]),
        ),
        Then('only the beta project empty file is reported as failing')((s, expect) => {
          const betaEmptySuite = noSuiteResultOf(s.response, `${s.project}/beta/src/empty.ts`)
          return expect({
            status: s.response.status,
            outcomes: outcomeOf(completedTestsOf(s.response)),
            betaEmptySuite: outcomeOf([betaEmptySuite]),
          }).toEqual({
            status: 'complete',
            outcomes: [
              { status: 'success', failureMessage: undefined },
              { status: 'success', failureMessage: undefined },
              { status: 'failed', failureMessage: `No test suite found in file ${s.project}/beta/src/empty.ts` },
            ],
            betaEmptySuite: [{
              status: 'failed',
              failureMessage: `No test suite found in file ${s.project}/beta/src/empty.ts`,
            }],
          })
        }),
      ),
    )
  })
