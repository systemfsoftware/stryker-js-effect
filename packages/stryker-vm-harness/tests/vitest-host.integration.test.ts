import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { Session } from '@systemfsoftware/stryker-vm-harness'

const Feature = makeFeature({ it })

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

const markerTextsTest = [
  "import { expect, test } from 'vitest'",
  '',
  'function probe() {',
  '  // comment keeps import.meta.vitest untouched',
  "  return 'import.meta.vitest'",
  '}',
  '',
  "const expected = ['import', 'meta', 'vitest'].join('.')",
  'const fromTemplate = `template keeps import.meta.vitest untouched`',
  'const expectedTemplate = `template keeps ${expected} untouched`',
  'const fromSubstitution = `${typeof import.meta.vitest?.it}`',
  '',
  "test('string, template and comment texts keep the marker', () => {",
  '  expect(probe()).toBe(expected)',
  "  expect(probe.toString()).toContain('// comment keeps ' + expected + ' untouched')",
  '  expect(fromTemplate).toBe(expectedTemplate)',
  "  expect(fromSubstitution).toBe('function')",
  '})',
  '',
].join('\n')

const inSourceModule = [
  'const api = import.meta.vitest',
  'if (api) {',
  "  api.it('an in-source guard registers and passes', () => undefined)",
  '}',
  '',
].join('\n')

const markerTextsConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { includeSource: ['src/**/*.ts'] },
})
`

const resolveFilesInMemory = (
  root: string,
  testFiles: ReadonlyArray<string>,
  plugins: ReadonlyArray<Session.VmSessionPlugin>,
): Effect.Effect<Session.VmRunResponse, never, never> =>
  Effect.gen(function*() {
    const session = yield* Effect.promise(() =>
      Session.createVmSession({ sandboxWorkingDirectory: root, testFiles: [...testFiles] }, plugins)
    )
    const response = yield* Effect.promise(() =>
      session.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true })
    )
    yield* Effect.promise(() => session.dispose())
    return response
  })

const resolveInMemory = (
  root: string,
  testFile: string,
  plugins: ReadonlyArray<Session.VmSessionPlugin>,
): Effect.Effect<Session.VmRunResponse, never, never> => resolveFilesInMemory(root, [testFile], plugins)

interface RunSummary {
  readonly status: string
  readonly testCount: number
  readonly failures: ReadonlyArray<{
    readonly name: string
    readonly status: string
    readonly failureMessage: string | undefined
  }>
}

const summarizeRun = (response: Session.VmRunResponse): RunSummary =>
  response.status === 'complete'
    ? {
      status: 'complete',
      testCount: response.tests.length,
      failures: response.tests
        .filter((test) => test.status !== 'success' || test.failureMessage !== undefined)
        .map((test) => ({ name: test.name, status: test.status, failureMessage: test.failureMessage })),
    }
    : { status: response.status, testCount: 0, failures: [] }

const passingRun = { status: 'complete', testCount: 1, failures: [] }

Feature('Loading a Vitest project in memory')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .live('the sandbox writes real project files and loads them through a real Vitest runtime')
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
        Then('the defaults describe a single node project and the listed file resolves beside it')((s, expect) => {
          const projects = s.handle.runtime.config.projects
          const project = projects[0]
          const testPath = `${s.project}/src/mathy.test.ts`
          const check = expect({
            projectCount: projects.length,
            include: project?.include,
            environment: project?.environment,
            isolate: project?.isolate,
            testTimeout: project?.testTimeout,
            hookTimeout: project?.hookTimeout,
            globals: project?.globals,
            files: s.listing.files,
            snapshotPath: s.handle.runtime.resolveSnapshotPathSync(testPath),
            transform: s.handle.runtime.transformSync('export const a = 1', testPath),
          }).toEqual({
            projectCount: 1,
            include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
            environment: 'node',
            isolate: true,
            testTimeout: 5000,
            hookTimeout: 10000,
            globals: false,
            files: [`${s.project}/src/mathy.test.ts`],
            snapshotPath: `${s.project}/src/__snapshots__/mathy.test.ts.snap`,
            transform: undefined,
          })
          return Effect.promise(() => s.handle.close()).pipe(
            Effect.andThen(removeProject(s.project)),
            Effect.as(check),
          )
        }),
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
        Then('both projects keep their names, environments, aliases, defines, env values and timeouts')((s, expect) => {
          const projects = s.handle.runtime.config.projects
          const dom = projects[1]
          const check = expect({
            projectCount: projects.length,
            names: projects.map((project) => project.name),
            environments: projects.map((project) => project.environment),
            domInclude: dom?.include,
            domAlias: dom?.alias,
            domDefine: dom?.define['import.meta.env.VITE_API'],
            domEnv: dom?.env['VITE_FLAG'],
            domTestTimeout: dom?.testTimeout,
            domSetupFiles: dom?.setupFiles,
          }).toEqual({
            projectCount: 2,
            names: ['unit', 'dom'],
            environments: ['node', 'jsdom'],
            domInclude: ['dom/**/*.test.ts'],
            domAlias: [{ find: '@lib', replacement: `${s.project}/src` }],
            domDefine: '"https://api.example"',
            domEnv: 'on',
            domTestTimeout: 7777,
            domSetupFiles: [`${s.project}/setup.ts`],
          })
          return Effect.promise(() => s.handle.close()).pipe(
            Effect.andThen(removeProject(s.project)),
            Effect.as(check),
          )
        }),
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
        Then('the listing keeps matched and in-source files and drops the ignored one')((s, expect) => {
          const files = s.listing.files
          const check = expect({
            keepsMatched: files.includes(`${s.project}/custom/alpha.check.ts`),
            keepsInSource: files.includes(`${s.project}/src/in-source.ts`),
            dropsIgnored: files.includes(`${s.project}/skipme/beta.check.ts`),
            setupFiles: s.handle.runtime.config.projects[0]?.setupFiles,
          }).toEqual({
            keepsMatched: true,
            keepsInSource: true,
            dropsIgnored: false,
            setupFiles: [`${s.project}/setup.ts`],
          })
          return Effect.promise(() => s.handle.close()).pipe(
            Effect.andThen(removeProject(s.project)),
            Effect.as(check),
          )
        }),
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
        Then('the component test passes against the transformed view')((s, expect) => {
          const check = expect(summarizeRun(s.response)).toEqual(passingRun)
          return removeProject(s.project).pipe(Effect.as(check))
        }),
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
          Then(`the suite passes with the value ${row.expected}`)((s, expect) => {
            const check = expect(summarizeRun(s.response)).toEqual(passingRun)
            return removeProject(s.project).pipe(Effect.as(check))
          }),
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
        Then('both tests pass against the aliased helper and its environment')((s, expect) => {
          const check = expect(summarizeRun(s.response)).toEqual({ status: 'complete', testCount: 2, failures: [] })
          return removeProject(s.project).pipe(Effect.as(check))
        }),
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
        Then('the rewritten value is what the test observed')((s, expect) => {
          const check = expect(summarizeRun(s.response)).toEqual(passingRun)
          return removeProject(s.project).pipe(Effect.as(check))
        }),
      ),
    )

    scenarioOutline(
      'A test file keeps marker text in its literals <config>',
      [
        { config: 'with a config file', configFile: markerTextsConfig },
        { config: 'without a config file', configFile: undefined },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(
            `a sandbox project ${row.config} whose test file mentions the in-source marker in text`,
          )(
            'project',
            () =>
              createProject(() => ({
                ...(row.configFile === undefined ? {} : { 'vitest.config.ts': row.configFile }),
                'src/in-source.ts': inSourceModule,
                'marker.test.ts': markerTextsTest,
              })),
          ),
          When('the suite runs in the in-memory vm runner')(
            'response',
            (s) =>
              resolveFilesInMemory(s.project, [`${s.project}/marker.test.ts`, `${s.project}/src/in-source.ts`], [
                Session.vitestConfigPlugin,
                Session.transformPlugin,
                Session.runnerStatePlugin,
              ]),
          ),
          Then('the marker texts are unchanged and the guarded suite passes')((s, expect) => {
            const names = s.response.status === 'complete' ? s.response.tests.map((test) => test.name) : []
            const check = expect({
              run: summarizeRun(s.response),
              registersGuard: names.some((name) => name.includes('an in-source guard registers and passes')),
            }).toEqual({
              run: { status: 'complete', testCount: 2, failures: [] },
              registersGuard: true,
            })
            return removeProject(s.project).pipe(Effect.as(check))
          }),
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
        Then('startup fails naming the vitest runner for browser suites')((s, expect) => {
          const check = expect({
            failed: s.attempt.failed,
            namesVitestRunner: s.attempt.message.includes("testRunner: 'vitest'"),
          }).toEqual({ failed: true, namesVitestRunner: true })
          return removeProject(s.prepared.root).pipe(Effect.as(check))
        }),
      ),
    )
  })
