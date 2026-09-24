import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { Session } from '@systemfsoftware/stryker-vm-harness'
import { assert, expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const stripViteFilePrefix = (pathname: string): string =>
  pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname

const NODE_MODULES_LINK_SOURCE = stripViteFilePrefix(
  decodeURIComponent(new URL('../../stryker-js/node_modules', import.meta.url).pathname),
)

type ProjectFiles = Readonly<Record<string, string>>

const createProject = (
  filesOf: (root: string) => ProjectFiles,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    const files = filesOf(root)
    for (const name of Object.keys(files)) {
      const target = path.join(root, name)
      const content = files[name]
      if (content === undefined) continue
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

const hostOver = (root: string): Session.VmPluginHost => ({
  sandboxWorkingDirectory: root,
  options: { sandboxWorkingDirectory: root, testFiles: [] },
  state: {
    read: <A extends object>(_key: string): A | undefined => undefined,
    write: <A extends object>(_key: string, _value: A): void => undefined,
  },
  resolveVitest: () => ({ expect: {}, vi: {} }),
  resolveVitestModule: () => root,
  importFile: () => Promise.resolve(),
})

const configFileOf = (root: string): string => `${root}/vitest.config.ts`

const projectsConfig = (root: string): string =>
  `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: [{ find: '@lib', replacement: '${root}/src' }],
    define: { 'import.meta.env.VITE_API': '"https://api.example"' },
    env: { VITE_FLAG: 'on' },
    testTimeout: 7777,
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['unit/**/*.test.ts'], setupFiles: ['./setup.ts'] } },
      { test: { name: 'dom', environment: 'jsdom', include: ['dom/**/*.test.ts'], setupFiles: ['./setup.ts'] } },
    ],
  },
})
`

const discoveryConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['custom/**/*.check.ts'],
    exclude: ['**/skipme/**'],
    includeSource: ['src/in-source.ts'],
    setupFiles: ['./setup.ts'],
  },
})
`

const aliasedConfig = (root: string): string =>
  `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: [{ find: '@lib', replacement: '${root}/src' }],
    define: { 'import.meta.env.VITE_API': '"https://api.example"' },
    env: { VITE_FLAG: 'on' },
  },
})
`

const markerPluginConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [{
    name: 'value-rewriter',
    transform(code) {
      return code.split('PLACEHOLDER').join('REWRITTEN')
    },
  }],
})
`

const browserConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: { enabled: true },
  },
})
`

const dataModuleTest = `import { expect, test } from 'vitest'
import styles from './styles.css'
import classes from './button.module.css'
import data from './data.json'
import logo from './logo.svg'
import raw from './greeting.txt?raw'

test('data modules import as plain values', () => {
  expect(styles).toBe('')
  expect(classes.button).toBe('button')
  expect(data.alpha).toBe(1)
  expect(logo).toBe('/logo.svg')
  expect(raw).toBe('raw text\\n')
})
`

const dataModules: ProjectFiles = {
  'styles.css': '.button { color: red }\n',
  'button.module.css': '.button { color: red }\n',
  'data.json': '{"alpha": 1}\n',
  'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  'greeting.txt': 'raw text\n',
  'data.test.ts': dataModuleTest,
}

const aliasedTest = `// @vitest-environment happy-dom
import { expect, test } from 'vitest'
import { util } from '@lib/util'

const envProbe = import.meta.env

test('aliased helper and env values are available', () => {
  expect(util()).toBe(1)
  expect(envProbe.VITE_API).toBe('https://api.example')
  expect(envProbe.VITE_FLAG).toBe('on')
})

test('the suite runs in a browser-like environment', () => {
  expect(typeof window).toBe('object')
})
`

const jsxTest = `import View from './src/view.tsx'
import { expect, test } from 'vitest'

test('a component is a callable view', () => {
  expect(View).toBeInstanceOf(Function)
})
`

const jsxConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' } },
})
`

const viewSource =
  `const h = (tag: string, props: object | null, ...children: ReadonlyArray<unknown>) => ({ tag, props, children })

const View = (props: { name: string }) => <p>hi {props.name}</p>

export default View
`

const markerTest = `import { expect, test } from 'vitest'
import { marker } from './src/marked.ts'

test('the project plugin rewrote the module value', () => {
  expect(marker).toBe('REWRITTEN')
})
`

const resolveInMemory = (
  root: string,
  testFile: string,
  plugins: ReadonlyArray<Session.VmSessionPlugin>,
): Effect.Effect<Session.VmRunResponse, never, never> =>
  Effect.gen(function*() {
    const session = yield* Effect.promise(() =>
      Session.createVmSession({ sandboxWorkingDirectory: root, testFiles: [testFile] }, plugins)
    )
    const response = yield* Effect.promise(() =>
      session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })
    )
    yield* Effect.promise(() => session.dispose())
    return response
  })

const dumpFailures = (response: Session.VmRunResponse): string =>
  response.status === 'complete'
    ? response.tests.map((test) => `${test.id}: ${test.status} ${test.failureMessage ?? ''}`).join('\n')
    : response.status
const assertSuitePassed = (response: Extract<Session.VmRunResponse, { readonly status: 'complete' }>): void => {
  const failures = dumpFailures(response)
  for (const test of response.tests) {
    assert(test.status === 'success', failures)
    assert(test.failureMessage === undefined, failures)
  }
}
const expectSuitePassed = (response: Session.VmRunResponse, expectedTests: number): void => {
  expect(response.status).toBe('complete')
  if (response.status !== 'complete') return
  expect(response.tests).toHaveLength(expectedTests)
  assertSuitePassed(response)
}

Feature('Loading a Vitest project in memory')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .liveClock()
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A project without a config file uses the Vitest defaults',
      Gherkin.Do.pipe(
        Given('a sandbox project with a test file and no config file')(
          'project',
          () =>
            createProject(() => ({
              'src/mathy.test.ts': "import { test } from 'vitest'\ntest('math', () => undefined)\n",
            })),
        ),
        When('the project config is resolved in memory')(
          'handle',
          (s) =>
            Effect.sync(() =>
              Session.createVmVitestRuntime({ sandboxWorkingDirectory: s.project, configFile: undefined })
            ),
        ),
        When('the test files are listed')(
          'listing',
          (s) => Effect.promise(() => s.handle.listTestFiles().then((files) => ({ files }))),
        ),
        Then('the defaults describe a single node project with the standard test glob')((s) =>
          Effect.sync(() => {
            expect(s.handle.runtime.config.projects).toHaveLength(1)
            const project = s.handle.runtime.config.projects[0]
            expect(project?.include).toEqual(['**/*.{test,spec}.?(c|m)[jt]s?(x)'])
            expect(project?.environment).toBe('node')
            expect(project?.isolate).toBe(true)
            expect(project?.testTimeout).toBe(5000)
            expect(project?.hookTimeout).toBe(10000)
            expect(project?.globals).toBe(false)
          })
        ),
        Then('the listed file is the standard test file and snapshots resolve beside it')((s) =>
          Effect.sync(() => {
            expect(s.listing.files).toEqual([`${s.project}/src/mathy.test.ts`])
            const testPath = `${s.project}/src/mathy.test.ts`
            expect(s.handle.runtime.resolveSnapshotPathSync(testPath)).toBe(
              `${s.project}/src/__snapshots__/mathy.test.ts.snap`,
            )
            expect(s.handle.runtime.transformSync('export const a = 1', testPath)).toBeUndefined()
          })
        ),
        Then('the runtime shuts down and the temporary project is removed')((s) =>
          Effect.gen(function*() {
            yield* Effect.promise(() => s.handle.close())
            yield* removeProject(s.project)
          })
        ),
      ),
    )

    scenario(
      'A config file yields two projects that keep their own settings',
      Gherkin.Do.pipe(
        Given('a sandbox project declaring a unit and a dom test project')(
          'project',
          () =>
            createProject((root) => ({
              'vitest.config.ts': projectsConfig(root),
              'setup.ts': 'export const setupMarker = true\n',
              'unit/one.test.ts': "import { test } from 'vitest'\ntest('one', () => undefined)\n",
              'dom/two.test.ts': "import { test } from 'vitest'\ntest('two', () => undefined)\n",
            })),
        ),
        When('the project config is resolved in memory')(
          'handle',
          (s) =>
            Effect.sync(() =>
              Session.createVmVitestRuntime({ sandboxWorkingDirectory: s.project, configFile: configFileOf(s.project) })
            ),
        ),
        Then('both projects keep their names and environments')((s) =>
          Effect.sync(() => {
            const projects = s.handle.runtime.config.projects
            expect(projects).toHaveLength(2)
            expect(projects[0]?.name).toBe('unit')
            expect(projects[0]?.environment).toBe('node')
            expect(projects[1]?.name).toBe('dom')
            expect(projects[1]?.environment).toBe('jsdom')
            expect(projects[1]?.include).toEqual(['dom/**/*.test.ts'])
          })
        ),
        Then('each project inherits the aliases, dotted defines, env values and timeouts')((s) =>
          Effect.sync(() => {
            const dom = s.handle.runtime.config.projects[1]
            expect(dom?.alias).toEqual([{ find: '@lib', replacement: `${s.project}/src` }])
            expect(dom?.define['import.meta.env.VITE_API']).toBe('"https://api.example"')
            expect(dom?.env['VITE_FLAG']).toBe('on')
            expect(dom?.testTimeout).toBe(7777)
            expect(dom?.setupFiles).toEqual([`${s.project}/setup.ts`])
          })
        ),
        Then('the runtime shuts down and the temporary project is removed')((s) =>
          Effect.gen(function*() {
            yield* Effect.promise(() => s.handle.close())
            yield* removeProject(s.project)
          })
        ),
      ),
    )

    scenario(
      'Only matching files are discovered for a configured project',
      Gherkin.Do.pipe(
        Given('a sandbox project with a matching test file, an ignored file and an in-source test')(
          'project',
          () =>
            createProject(() => ({
              'vitest.config.ts': discoveryConfig,
              'setup.ts': 'export const setupMarker = true\n',
              'custom/alpha.check.ts': "import { test } from 'vitest'\ntest('alpha', () => undefined)\n",
              'skipme/beta.check.ts': "import { test } from 'vitest'\ntest('beta', () => undefined)\n",
              'src/in-source.ts':
                "export const value = 1\nif (import.meta.vitest) { it('in source', () => undefined) }\n",
            })),
        ),
        When('the project config is resolved in memory')(
          'handle',
          (s) =>
            Effect.sync(() =>
              Session.createVmVitestRuntime({ sandboxWorkingDirectory: s.project, configFile: configFileOf(s.project) })
            ),
        ),
        When('the test files are listed')(
          'listing',
          (s) => Effect.promise(() => s.handle.listTestFiles().then((files) => ({ files }))),
        ),
        Then('the listing keeps matched and in-source files and drops the ignored one')((s) =>
          Effect.sync(() => {
            expect(s.listing.files).toContain(`${s.project}/custom/alpha.check.ts`)
            expect(s.listing.files).toContain(`${s.project}/src/in-source.ts`)
            expect(s.listing.files).not.toContain(`${s.project}/skipme/beta.check.ts`)
            expect(s.handle.runtime.config.projects[0]?.setupFiles).toEqual([`${s.project}/setup.ts`])
          })
        ),
        Then('the runtime shuts down and the temporary project is removed')((s) =>
          Effect.gen(function*() {
            yield* Effect.promise(() => s.handle.close())
            yield* removeProject(s.project)
          })
        ),
      ),
    )

    scenario(
      'JSX in a project file compiles for the in-memory loader',
      Gherkin.Do.pipe(
        Given('a sandbox project whose JSX file declares its own factory')(
          'project',
          () =>
            createProject(() => ({
              'vitest.config.ts': jsxConfig,
              'src/view.tsx': viewSource,
              'view.test.ts': jsxTest,
            })),
        ),
        When('the suite runs in memory')(
          'response',
          (s) =>
            resolveInMemory(s.project, `${s.project}/view.test.ts`, [
              Session.vitestConfigPlugin,
              Session.transformPlugin,
            ]),
        ),
        Then('the component test passes against the transformed view')((s) =>
          Effect.sync(() => expectSuitePassed(s.response, 1))
        ),
        Then('the temporary project is removed')((s) => removeProject(s.project)),
      ),
    )

    scenarioOutline(
      '<module> loads as a data module inside the suite',
      [
        { module: 'styles.css', content: '.button { color: red }\n', expected: '' },
        { module: 'button.module.css', content: '.button { color: red }\n', expected: 'button' },
        { module: 'data.json', content: '{"alpha": 1}\n', expected: '' },
        { module: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n', expected: '/logo.svg' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a sandbox project whose test consumes ${row.module}`)(
            'project',
            () => createProject(() => ({ ...dataModules, 'data.test.ts': dataModuleTest })),
          ),
          When('the suite runs in memory')(
            'response',
            (s) =>
              resolveInMemory(s.project, `${s.project}/data.test.ts`, [
                Session.vitestConfigPlugin,
                Session.transformPlugin,
              ]),
          ),
          Then(`the suite passes with the value ${row.expected}`)((s) =>
            Effect.sync(() => expectSuitePassed(s.response, 1))
          ),
          And('the temporary project is removed')((s) => removeProject(s.project)),
        ),
    )

    scenario(
      'Aliases, the environment object and the environment docblock are honoured',
      Gherkin.Do.pipe(
        Given('a sandbox project aliasing a library prefix with configured values')(
          'project',
          () =>
            createProject((root) => ({
              'vitest.config.ts': aliasedConfig(root),
              'src/util.ts': 'export const util = () => 1\n',
              'app.test.ts': aliasedTest,
            })),
        ),
        When('the suite runs in memory')(
          'response',
          (s) =>
            resolveInMemory(s.project, `${s.project}/app.test.ts`, [
              Session.vitestConfigPlugin,
              Session.definePlugin,
              Session.environmentPlugin,
              Session.globalsPlugin,
              Session.transformPlugin,
              Session.runnerStatePlugin,
            ]),
        ),
        Then('both tests pass against the aliased helper and its environment')((s) =>
          Effect.sync(() => {
            expectSuitePassed(s.response, 2)
          })
        ),
        Then('the temporary project is removed')((s) => removeProject(s.project)),
      ),
    )

    scenario(
      'A project plugin rewrites test sources',
      Gherkin.Do.pipe(
        Given('a sandbox project whose config registers a value-rewriting plugin')(
          'project',
          () =>
            createProject(() => ({
              'vitest.config.ts': markerPluginConfig,
              'src/marked.ts': "export const marker = 'PLACEHOLDER'\n",
              'marker.test.ts': markerTest,
            })),
        ),
        When('the suite runs in memory')(
          'response',
          (s) =>
            resolveInMemory(s.project, `${s.project}/marker.test.ts`, [
              Session.vitestConfigPlugin,
              Session.transformPlugin,
            ]),
        ),
        Then('the rewritten value is what the test observed')((s) =>
          Effect.sync(() => expectSuitePassed(s.response, 1))
        ),
        Then('the temporary project is removed')((s) => removeProject(s.project)),
      ),
    )

    scenario(
      'Browser mode refuses to start in memory',
      Gherkin.Do.pipe(
        Given('a sandbox project enabled for browser mode')(
          'prepared',
          () =>
            Effect.gen(function*() {
              const root = yield* createProject(() => ({ 'vitest.config.ts': browserConfig }))
              return { root, host: hostOver(root) }
            }),
        ),
        When('the session is started against the browser project')(
          'attempt',
          (s) =>
            Effect.promise(() =>
              Promise.resolve(Session.vitestConfigPlugin.init?.(s.prepared.host)).then(
                () => ({ failed: false, message: '' }),
                (reason: { message?: string }) => ({ failed: true, message: reason.message ?? '' }),
              )
            ),
        ),
        Then('startup fails naming the vitest runner for browser suites')((s) =>
          Effect.sync(() => {
            expect(s.attempt.failed).toBe(true)
            expect(s.attempt.message).toContain("testRunner: 'vitest'")
          })
        ),
        Then('the temporary project is removed')((s) => removeProject(s.prepared.root)),
      ),
    )
  })
