import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface SuiteOnDisk {
  readonly directory: string
  readonly files: readonly string[]
}

const PACKAGES_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const SANDBOX_DEPENDENCIES = `${PACKAGES_ROOT}/stryker-vm-harness/node_modules`

const writeSuites = (
  sources: readonly string[],
): Effect.Effect<SuiteOnDisk, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.symlink(SANDBOX_DEPENDENCIES, path.join(directory, 'node_modules'))
    const files: string[] = []
    for (const [index, source] of sources.entries()) {
      const file = path.join(directory, `suite-${index}.test.ts`)
      yield* fs.writeFileString(file, source)
      files.push(file)
    }
    return { directory, files }
  }).pipe(Effect.orDie)

interface ToldEvent {
  readonly stage: string
  readonly detail: string | undefined
}

const recorderPlugin = (told: Array<ToldEvent>): Session.VmSessionPlugin => {
  const note = (stage: string, detail?: string) => {
    told.push({ stage, detail })
  }
  return {
    name: 'recorder',
    init: () => note('was set up'),
    beforeGraphLoad: () => note('heard the suite is about to load'),
    beforeFileImport: (file) => note('heard a file is about to load', file.file),
    afterFileImport: (file) => note('heard a file finished loading', file.file),
    beforeFileRun: (file) => note('heard a file is about to run', file.file),
    beforeTest: (test) => note('heard a test is about to run', test.name),
    afterTest: (test) => note('heard a test finished', test.name),
    afterFileRun: (file) => note('heard a file finished running', file.file),
    afterRun: () => note('heard the run finished'),
    disposeGraph: () => note('heard the loaded suite is being let go'),
  }
}

const stagesOf = (told: ReadonlyArray<ToldEvent>): readonly string[] => told.map((event) => event.stage)

const dryRunOf = (session: Session.VmSession): Promise<Session.VmRunResponse> =>
  session.run({ kind: 'dry', timeoutMs: 5000, reloadEnvironment: true })

Feature('Extending a harness session with plugins')
  .withScenarioLayer(suiteFileLayer)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A plugin is told about each step of a run in the order it happened',
      Gherkin.Do.pipe(
        Given('a written suite with two passing tests')(
          'suite',
          () =>
            writeSuites([
              [
                "import { test } from 'vitest'",
                '',
                "test('adds numbers', () => {})",
                '',
                "test('subtracts numbers', () => {})",
              ].join('\n'),
            ]),
        ),
        When('the session checks the suite with a plugin that writes down what it is told')(
          'heard',
          (s) =>
            Effect.gen(function*() {
              const told: Array<ToldEvent> = []
              const session = yield* Effect.promise(() =>
                Session.createVmSession(
                  { sandboxWorkingDirectory: s.suite.directory, testFiles: s.suite.files },
                  [recorderPlugin(told)],
                )
              )
              const response = yield* Effect.promise(() => dryRunOf(session))
              yield* Effect.promise(() => session.dispose())
              return { told, response }
            }),
        ),
        Then('the plugin heard about loading, running, and finishing, in that order')((s) => {
          expect(s.heard.response).toMatchObject({
            status: 'complete',
            tests: [
              { name: 'adds numbers', status: 'success' },
              { name: 'subtracts numbers', status: 'success' },
            ],
          })
          expect(stagesOf(s.heard.told)).toEqual([
            'was set up',
            'heard the suite is about to load',
            'heard a file is about to load',
            'heard a file finished loading',
            'heard a file is about to run',
            'heard a test is about to run',
            'heard a test finished',
            'heard a test is about to run',
            'heard a test finished',
            'heard a file finished running',
            'heard the run finished',
            'heard the loaded suite is being let go',
          ])
          expect(s.heard.response.status).toBe('complete')
        }),
        Then('the plugin heard which files and tests each step was about')((s) => {
          const aboutFiles = s.heard.told.filter((event) => event.stage === 'heard a file is about to load')
          expect(aboutFiles.map((event) => event.detail?.endsWith('suite-0.test.ts'))).toEqual([true])
          const aboutTests = s.heard.told.filter((event) => event.stage === 'heard a test is about to run')
          expect(aboutTests.map((event) => event.detail)).toEqual(['adds numbers', 'subtracts numbers'])
        }),
      ),
    )

    scenario(
      'A plugin is told when the loaded suite is let go',
      Gherkin.Do.pipe(
        Given('a written suite that was already checked once')(
          'checked',
          () =>
            writeSuites(["import { test } from 'vitest'\n\ntest('passes', () => {})"]).pipe(
              Effect.flatMap((written) =>
                Effect.gen(function*() {
                  const told: Array<ToldEvent> = []
                  const session = yield* Effect.promise(() =>
                    Session.createVmSession(
                      { sandboxWorkingDirectory: written.directory, testFiles: written.files },
                      [recorderPlugin(told)],
                    )
                  )
                  yield* Effect.promise(() => dryRunOf(session))
                  return { session, told }
                })
              ),
              Effect.orDie,
            ),
        ),
        When('the session is closed')(
          'heard',
          (s) => Effect.promise(() => s.checked.session.dispose()).pipe(Effect.as(s.checked.told)),
        ),
        Then('the plugin heard that the loaded suite is being let go')((s) => {
          const stages = stagesOf(s.heard)
          expect(stages.at(-1)).toBe('heard the loaded suite is being let go')
        }),
      ),
    )

    scenario(
      'A test is told which run it belongs to and how it ended',
      Gherkin.Do.pipe(
        Given('a written suite whose only test fails when the change is active')(
          'suite',
          () =>
            writeSuites([
              [
                "const stryker = globalThis['__stryker__']",
                "import { test } from 'vitest'",
                '',
                "test('guards the change', () => {",
                "  if (stryker !== undefined && stryker.activeMutant === 'mutant-1') {",
                "    throw new Error('the mutated program ran')",
                '  }',
                '})',
              ].join('\n'),
            ]),
        ),
        When('the session verifies that change')(
          'heard',
          (s) =>
            Effect.gen(function*() {
              const told: Array<ToldEvent> = []
              const session = yield* Effect.promise(() =>
                Session.createVmSession(
                  { sandboxWorkingDirectory: s.suite.directory, testFiles: s.suite.files },
                  [recorderPlugin(told)],
                )
              )
              const response = yield* Effect.promise(() =>
                session.run({
                  kind: 'mutant',
                  timeoutMs: 5000,
                  activeMutantId: 'mutant-1',
                  reloadEnvironment: true,
                })
              )
              yield* Effect.promise(() => session.dispose())
              return { told, response }
            }),
        ),
        Then('the plugin heard the test ended badly and the change was caught')((s) => {
          expect(s.heard.response.status).toBe('complete')
          const finished = s.heard.told.filter((event) => event.stage === 'heard a test finished')
          expect(finished).toHaveLength(1)
          expect(s.heard.response.status === 'complete' && s.heard.response.tests[0]?.status).toBe('failed')
        }),
      ),
    )

    scenario(
      'A hook declared outside every suite in one file never runs for another file',
      Gherkin.Do.pipe(
        Given('two written suites where only the first declares such a hook')(
          'suite',
          () =>
            writeSuites([
              [
                "import { test, beforeEach } from 'vitest'",
                '',
                'const told: string[] = []',
                'globalThis.__HOOK_TOLD_SUITE_0__ = told',
                'beforeEach(() => { told.push("outside hook ran") })',
                '',
                "test('first file test', () => {})",
              ].join('\n'),
              [
                "import { test } from 'vitest'",
                '',
                "test('second file test', () => {",
                '  const leaked = (globalThis as { __HOOK_TOLD_SUITE_0__?: string[] }).__HOOK_TOLD_SUITE_0__',
                '  if (leaked !== undefined && leaked.length > 0) {',
                "    throw new Error('the other file\\'s hook ran here')",
                '  }',
                '})',
              ].join('\n'),
            ]),
        ),
        When('the session checks both files together')(
          'response',
          (s) =>
            Effect.gen(function*() {
              const session = yield* Effect.promise(() =>
                Session.createVmSession({ sandboxWorkingDirectory: s.suite.directory, testFiles: s.suite.files }, [])
              )
              const response = yield* Effect.promise(() => dryRunOf(session))
              yield* Effect.promise(() => session.dispose())
              return response
            }),
        ),
        Then('both files pass and the hook stayed with its own file')((s) => {
          expect(s.response.status).toBe('complete')
          if (s.response.status === 'complete') {
            expect(s.response.tests.map((test) => test.status)).toEqual(['success', 'success'])
          }
        }),
      ),
    )

    scenario(
      'Two files that share a helper each get their own copy of it',
      Gherkin.Do.pipe(
        Given('a shared counter and two suites that each expect it to start at zero')(
          'suite',
          () =>
            Effect.gen(function*() {
              const written = yield* writeSuites([
                "import { test } from 'vitest'\nimport { bump } from './counter.js'\n\ntest('first file sees a fresh counter', () => {\n  if (bump() !== 1) { throw new Error('the counter was already advanced') }\n})",
                "import { test } from 'vitest'\nimport { bump } from './counter.js'\n\ntest('second file sees a fresh counter', () => {\n  if (bump() !== 1) { throw new Error('the counter was already advanced') }\n})",
              ])
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              yield* fs.writeFileString(
                path.join(written.directory, 'counter.ts'),
                'let count = 0\nexport const bump = (): number => {\n  count += 1\n  return count\n}\n',
              )
              return written
            }).pipe(Effect.provide(suiteFileLayer), Effect.orDie),
        ),
        When('the session checks both files together')(
          'response',
          (s) =>
            Effect.gen(function*() {
              const session = yield* Effect.promise(() =>
                Session.createVmSession({ sandboxWorkingDirectory: s.suite.directory, testFiles: s.suite.files }, [])
              )
              const response = yield* Effect.promise(() => dryRunOf(session))
              yield* Effect.promise(() => session.dispose())
              return response
            }),
        ),
        Then('both files saw their own fresh counter')((s) => {
          expect(s.response.status).toBe('complete')
          if (s.response.status === 'complete') {
            expect(s.response.tests.map((test) => test.status)).toEqual(['success', 'success'])
          }
        }),
      ),
    )
  })
