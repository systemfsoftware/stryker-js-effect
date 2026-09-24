import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  createVmSession,
  createVmVitestRuntime,
  type VmRunResponse,
  type VmTestResult,
} from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

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

const runSuite = (root: string, file: string): Effect.Effect<VmRunResponse, never, never> =>
  Effect.gen(function*() {
    const session = yield* Effect.promise(() => createVmSession({ sandboxWorkingDirectory: root, testFiles: [file] }))
    return yield* Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })).pipe(
      Effect.ensuring(Effect.promise(() => session.dispose())),
    )
  })

interface ReleasedRun {
  readonly root: string
  readonly response: VmRunResponse
}

const runAndRelease = (root: string, file: string): Effect.Effect<ReleasedRun, never, never> =>
  Effect.map(runSuite(root, file), (response) => ({ root, response }))

const testOf = (response: VmRunResponse, name: string): VmTestResult => {
  if (response.status !== 'complete') {
    throw new Error(`expected a completed run, saw ${response.status}`)
  }
  const found = response.tests.find((test) => test.name === name)
  if (found === undefined) {
    throw new Error(`no test named ${name} in ${response.tests.map((test) => test.name).join(', ')}`)
  }
  return found
}

const REPEATS_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    repeats: 2,
  },
})
`

const REPEATS_TEST = `import { expect, test } from 'vitest'

const runs: Array<string> = []

test('first body records each run', () => {
  runs.push('a')
})

test('second body sees three runs from the first', () => {
  runs.push('b')
  expect(runs.filter((entry) => entry === 'a')).toEqual(['a', 'a', 'a'])
})
`

const PATTERN_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testNamePattern: 'keeps',
  },
})
`

const PATTERN_TEST = `import { expect, test } from 'vitest'

test('keeps this one', () => {
  expect(1).toBe(1)
})

test('drops this one', () => {
  expect(1).toBe(1)
})
`

const GLOBAL_SETUP_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./global-setup.ts'],
  },
})
`

const GLOBAL_SETUP = `import { appendFileSync } from 'node:fs'

const log = new URL('./order.log', import.meta.url)

export default function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  provide('port', 1234)
  appendFileSync(log, 'setup\\n')
  return () => {
    appendFileSync(log, 'teardown\\n')
  }
}
`

const GLOBAL_SETUP_FIRST = `import { readFileSync } from 'node:fs'
import { expect, inject, test } from 'vitest'

test('the first file reads the provided value after setup', () => {
  expect(inject('port')).toBe(1234)
  expect(readFileSync(new URL('./order.log', import.meta.url), 'utf8')).toBe('setup\\n')
})
`

const GLOBAL_SETUP_SECOND = `import { readFileSync } from 'node:fs'
import { expect, inject, test } from 'vitest'

test('the second file sees the same single setup', () => {
  expect(inject('port')).toBe(1234)
  expect(readFileSync(new URL('./order.log', import.meta.url), 'utf8')).toBe('setup\\n')
})
`

const CJS_GLOBALS_TEST = `import { expect, test } from 'vitest'

test('the CommonJS globals are injected into the module', () => {
  expect(typeof require).toBe('function')
  expect(typeof module).toBe('object')
  expect(typeof exports).toBe('object')
  expect(__filename.endsWith('cjs-globals.test.ts')).toBe(true)
  expect(__dirname.length).toBeGreaterThan(0)
})
`

const TAGS_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    tags: [{ name: 'known' }],
  },
})
`

const UNDECLARED_TAG_TEST = `import { expect, test } from 'vitest'

test('tagged with an undeclared tag', { tags: ['nope'] }, () => {
  expect(1).toBe(1)
})
`

const RELAXED_TAGS_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    tags: [{ name: 'known' }],
    strictTags: false,
  },
})
`

const SEQUENCE_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    sequence: { shuffle: true, seed: 42, hooks: 'list', setupFiles: 'parallel' },
  },
})
`

Feature('Honouring the Vitest project configuration')
  .withLayer(suiteFileLayer)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A configured repeat count reruns the body for every scheduled pass',
      Gherkin.Do.pipe(
        Given('a project that repeats each test twice')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': REPEATS_CONFIG,
              'repeats.test.ts': REPEATS_TEST,
            }),
        ),
        When('the suite runs')('run', (s) => runAndRelease(s.project, `${s.project}/repeats.test.ts`)),
        Then('both bodies pass and the second saw all three passes')((s) => {
          expect(s.run.response.status).toBe('complete')
          const first = testOf(s.run.response, 'first body records each run')
          expect(first.status).toBe('success')
          expect(first.failureMessage).toBeUndefined()
          const second = testOf(s.run.response, 'second body sees three runs from the first')
          expect(second.status).toBe('success')
          expect(second.failureMessage).toBeUndefined()
        }),
        And('the temporary project is removed')((s) => Effect.as(removeProject(s.run.root), undefined)),
      ),
    )

    scenario(
      'A name pattern skips the tests it does not match',
      Gherkin.Do.pipe(
        Given('a project that only keeps matching names')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': PATTERN_CONFIG,
              'pattern.test.ts': PATTERN_TEST,
            }),
        ),
        When('the suite runs')('run', (s) => runAndRelease(s.project, `${s.project}/pattern.test.ts`)),
        Then('the matching test passed and the other was skipped')((s) => {
          expect(s.run.response.status).toBe('complete')
          const kept = testOf(s.run.response, 'keeps this one')
          expect(kept.status).toBe('success')
          expect(kept.failureMessage).toBeUndefined()
          const dropped = testOf(s.run.response, 'drops this one')
          expect(dropped.status).toBe('skipped')
          expect(dropped.failureMessage).toBeUndefined()
        }),
        And('the temporary project is removed')((s) => Effect.as(removeProject(s.run.root), undefined)),
      ),
    )

    scenario(
      'A global setup module runs once before the files, provides values, and tears down last',
      Gherkin.Do.pipe(
        Given('a project whose global setup provides a value and logs its phases')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': GLOBAL_SETUP_CONFIG,
              'global-setup.ts': GLOBAL_SETUP,
              'first.test.ts': GLOBAL_SETUP_FIRST,
              'second.test.ts': GLOBAL_SETUP_SECOND,
            }),
        ),
        When('both suites run and the session is released')(
          'run',
          (s) =>
            Effect.gen(function*() {
              const session = yield* Effect.promise(() =>
                createVmSession({
                  sandboxWorkingDirectory: s.project,
                  testFiles: [`${s.project}/first.test.ts`, `${s.project}/second.test.ts`],
                })
              )
              const response = yield* Effect.promise(() =>
                session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })
              ).pipe(Effect.ensuring(Effect.promise(() => session.dispose())))
              return { root: s.project, response }
            }),
        ),
        Then('both files read the provided value after the single setup')((s) => {
          expect(s.run.response.status).toBe('complete')
          const first = testOf(s.run.response, 'the first file reads the provided value after setup')
          expect(first.status).toBe('success')
          expect(first.failureMessage).toBeUndefined()
          const second = testOf(s.run.response, 'the second file sees the same single setup')
          expect(second.status).toBe('success')
          expect(second.failureMessage).toBeUndefined()
        }),
        And('teardown ran after the last file')(
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const log = yield* fs.readFileString(path.join(s.run.root, 'order.log'))
              expect(log).toBe('setup\nteardown\n')
              yield* removeProject(s.run.root)
            }),
        ),
      ),
    )

    scenario(
      'CommonJS globals are injected when nothing disables them',
      Gherkin.Do.pipe(
        Given('a project with no module settings at all')(
          'project',
          () =>
            createProject({
              'cjs-globals.test.ts': CJS_GLOBALS_TEST,
            }),
        ),
        When('the suite runs')('run', (s) => runAndRelease(s.project, `${s.project}/cjs-globals.test.ts`)),
        Then('every CommonJS global is present in the module')((s) => {
          expect(s.run.response.status).toBe('complete')
          const outcome = testOf(s.run.response, 'the CommonJS globals are injected into the module')
          expect(outcome.status).toBe('success')
          expect(outcome.failureMessage).toBeUndefined()
        }),
        And('the temporary project is removed')((s) => Effect.as(removeProject(s.run.root), undefined)),
      ),
    )

    scenario(
      'A test tagged outside the declared set fails to collect',
      Gherkin.Do.pipe(
        Given('a project declaring one tag and checking them strictly')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': TAGS_CONFIG,
              'tags.test.ts': UNDECLARED_TAG_TEST,
            }),
        ),
        When('the suite runs')('run', (s) => runAndRelease(s.project, `${s.project}/tags.test.ts`)),
        Then('nothing ran and the collection names the tag')((s) => {
          expect(s.run.response.status).toBe('complete')
          if (s.run.response.status !== 'complete') return
          expect(s.run.response.tests).toHaveLength(1)
          const outcome = s.run.response.tests[0]
          if (outcome === undefined) throw new Error('expected the collection failure row')
          expect(outcome.status).toBe('failed')
          expect(outcome.failureMessage).toBe(
            'The tag "nope" is not defined in the configuration. Available tags are:\n- known',
          )
        }),
        And('the temporary project is removed')((s) => Effect.as(removeProject(s.run.root), undefined)),
      ),
    )

    scenario(
      'A project that relaxes tag checking runs tests carrying any tag',
      Gherkin.Do.pipe(
        Given('a project declaring one tag but not checking them')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': RELAXED_TAGS_CONFIG,
              'tags.test.ts': UNDECLARED_TAG_TEST,
            }),
        ),
        When('the suite runs')('run', (s) => runAndRelease(s.project, `${s.project}/tags.test.ts`)),
        Then('the tagged test runs and passes')((s) => {
          expect(s.run.response.status).toBe('complete')
          const outcome = testOf(s.run.response, 'tagged with an undeclared tag')
          expect(outcome.status).toBe('success')
          expect(outcome.failureMessage).toBeUndefined()
        }),
        And('the temporary project is removed')((s) => Effect.as(removeProject(s.run.root), undefined)),
      ),
    )

    scenario(
      'Configured sequencing options reach the session',
      Gherkin.Do.pipe(
        Given('a project sequencing with a fixed seed')(
          'project',
          () =>
            createProject({
              'vitest.config.ts': SEQUENCE_CONFIG,
              'order.test.ts': "import { test } from 'vitest'\ntest('ordering', () => undefined)\n",
            }),
        ),
        When('the session configuration is resolved')(
          'handle',
          (s) =>
            Effect.sync(() =>
              createVmVitestRuntime({
                sandboxWorkingDirectory: s.project,
                configFile: `${s.project}/vitest.config.ts`,
              })
            ),
        ),
        Then('the project carries every sequencing option')((s) =>
          Effect.gen(function*() {
            expect(s.handle.runtime.config.projects).toHaveLength(1)
            const project = s.handle.runtime.config.projects[0]
            expect(project?.sequence).toEqual({
              concurrent: false,
              shuffle: true,
              seed: 42,
              hooks: 'list',
              setupFiles: 'parallel',
            })
            yield* Effect.promise(() => s.handle.close())
            yield* removeProject(s.project)
          })
        ),
      ),
    )

    scenario(
      'A project without sequencing options uses the Vitest defaults',
      Gherkin.Do.pipe(
        Given('a project with a test file and no config file')(
          'project',
          () =>
            createProject({
              'plain.test.ts': "import { test } from 'vitest'\ntest('plain', () => undefined)\n",
            }),
        ),
        When('the session configuration is resolved')(
          'handle',
          (s) =>
            Effect.sync(() => createVmVitestRuntime({ sandboxWorkingDirectory: s.project, configFile: undefined })),
        ),
        Then('the project runs files in order with the default hook policy')((s) =>
          Effect.gen(function*() {
            expect(s.handle.runtime.config.projects).toHaveLength(1)
            const project = s.handle.runtime.config.projects[0]
            expect(project?.sequence.concurrent).toBe(false)
            expect(project?.sequence.shuffle).toBe(false)
            expect(project?.sequence.hooks).toBe('stack')
            expect(project?.sequence.setupFiles).toBe('parallel')
            yield* Effect.promise(() => s.handle.close())
            yield* removeProject(s.project)
          })
        ),
      ),
    )
  })
