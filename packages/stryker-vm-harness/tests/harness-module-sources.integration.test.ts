import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { EffectAdapter, Registry, Sandbox } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const Feature = makeFeature({ it })

const FIRST_PARTY_PACKAGES = [
  'vitest',
  '@effect/vitest',
  '@systemfsoftware/effect-gherkin-spec',
] as const
const EXPECTED_SURFACE = ['describe', 'it', 'test', 'beforeEach', 'expect'] as const

const nodeRegisterHooks = globalThis.process.getBuiltinModule('node:module').registerHooks

const liveBuiltin: Sandbox.HarnessModuleBuiltin = {
  registerHooks: (hooks) => {
    const registered = nodeRegisterHooks(hooks)
    return { deregister: () => registered.deregister() }
  },
}

const quietRuntime = (): Sandbox.InterceptionRuntime => ({
  host: {
    sandboxWorkingDirectory: decodeURIComponent(new URL('../', import.meta.url).pathname),
    options: { sandboxWorkingDirectory: decodeURIComponent(new URL('../', import.meta.url).pathname), testFiles: [] },
    state: {
      read: () => undefined,
      write: () => undefined,
    },
    resolveVitest: () => ({ expect: {}, vi: undefined }),
    resolveVitestModule: (specifier: string): string => import.meta.resolve(specifier),
    importFile: () => Promise.resolve(undefined),
  },
  plugins: [],
})

const sandboxPrefix = new URL('./', import.meta.url).href

interface ServedRunnerModule {
  readonly describe: (name: string, body: () => void) => void
  readonly it: (name: string, body: () => void) => void
  readonly test: (name: string, body: () => void) => void
  readonly beforeEach: (hook: () => void) => void
  readonly expect: object
}

type ServedSurfaceName = 'describe' | 'it' | 'test' | 'beforeEach' | 'expect'

interface ServedModuleReport {
  readonly address: string
  readonly surface: ReadonlyArray<string>
  readonly registered: ReadonlyArray<string>
}

const releaseSandbox = Effect.sync(() => {
  Sandbox.deactivateSandbox()
  Sandbox.writeGlobalState(undefined)
  Sandbox.uninstallInterception()
})

const quietExpect = (value: object): object => value

const loadServedModule = (packageName: string): Effect.Effect<ServedModuleReport> =>
  Effect.gen(function*() {
    const address = Sandbox.harnessUrlForSpecifier(packageName)
    if (address === undefined) {
      throw new Error(`no module is served for "${packageName}"`)
    }
    const registry = Registry.createRegistry()
    const api = Registry.createHarnessApi(registry)
    const state: Sandbox.VmRunnerGlobalState = {
      api,
      expect: quietExpect,
      vi: undefined,
      effectVitest: {
        it: EffectAdapter.makeEffectMethods({
          api: api.it,
          describe: api.describe,
          hooks: api.hooks,
          tests: registry.tests,
        }),
      },
      projectConfig: undefined,
      provided: registry.provided.current,
    }
    Sandbox.installInterception(liveBuiltin, quietRuntime())
    Sandbox.activateSandbox(sandboxPrefix)
    Sandbox.writeGlobalState(state)
    try {
      const served = yield* Effect.promise(() =>
        Sandbox.nativeImport<Partial<ServedRunnerModule>>(`${address}?salt=${encodeURIComponent(sandboxPrefix)}`)
      )
      const surface: ServedSurfaceName[] = []
      for (const name of EXPECTED_SURFACE) {
        if (served[name] !== undefined) {
          surface.push(name)
        }
      }
      const { describe: describeSurface, it: itSurface } = served
      if (describeSurface === undefined || itSurface === undefined) {
        throw new Error(`loading "${packageName}" exposed no registration surface`)
      }
      describeSurface('a served suite', () => {
        itSurface('a served test', () => undefined)
      })
      const published = Sandbox.readGlobalState()
      if (published !== state) {
        throw new Error(`loading "${packageName}" replaced the published harness state`)
      }
      return { address, surface, registered: registry.tests.map((registered) => registered.name) }
    } finally {
      yield* releaseSandbox
    }
  }).pipe(Effect.ensuring(releaseSandbox))

Feature('Resolving the harness modules a sandboxed test file loads')
  .withLayer(Layer.empty)
  .live('the served modules are loaded through real node loader hooks installed and deregistered per scenario')
  .body(({ scenario }) => {
    scenario(
      'A test file importing a first-party runner package is pointed at its harness module',
      Gherkin.Do.pipe(
        Given('the runner packages a sandboxed test file may import, plus one the harness does not serve')(
          'packages',
          () => Effect.succeed({ served: FIRST_PARTY_PACKAGES, unserved: 'unknown-module' }),
        ),
        When('the sandbox resolves each package to the module address it will load')(
          'addresses',
          (s) =>
            Effect.succeed({
              vitest: Sandbox.harnessUrlForSpecifier(s.packages.served[0]),
              effectVitest: Sandbox.harnessUrlForSpecifier(s.packages.served[1]),
              gherkin: Sandbox.harnessUrlForSpecifier(s.packages.served[2]),
              unserved: Sandbox.harnessUrlForSpecifier(s.packages.unserved),
            }),
        ),
        Then('the served packages map to their own harness addresses and the unserved one maps to nothing')(
          (s, expect) =>
            expect(s.addresses).toEqual({
              vitest: 'vmrunner-harness:vitest',
              effectVitest: 'vmrunner-harness:@effect/vitest',
              gherkin: 'vmrunner-harness:@systemfsoftware/effect-gherkin-spec',
              unserved: undefined,
            }),
        ),
      ),
    )

    scenario(
      'Each served harness module exposes its registration surface and registers a suite',
      Gherkin.Do.pipe(
        Given('the first-party runner packages a sandboxed test file may import')(
          'packages',
          () => Effect.succeed(FIRST_PARTY_PACKAGES),
        ),
        When('the sandbox loads each package through its served module')(
          'served',
          (s) =>
            Effect.gen(function*() {
              const loaded: ServedModuleReport[] = []
              for (const packageName of s.packages) {
                loaded.push(yield* loadServedModule(packageName))
              }
              return { loaded, unknown: Sandbox.harnessSourceFor('unknown-url') }
            }),
        ),
        Then('every module carries the registration surface, registers its suite, and no unknown address serves')(
          (s, expect) =>
            expect({
              addresses: s.served.loaded.map((entry) => entry.address),
              surfaces: s.served.loaded.map((entry) => entry.surface),
              registered: s.served.loaded.map((entry) => entry.registered),
              unknown: s.served.unknown,
            }).toEqual({
              addresses: [
                'vmrunner-harness:vitest',
                'vmrunner-harness:@effect/vitest',
                'vmrunner-harness:@systemfsoftware/effect-gherkin-spec',
              ],
              surfaces: [
                [...EXPECTED_SURFACE],
                [...EXPECTED_SURFACE],
                [...EXPECTED_SURFACE],
              ],
              registered: [['a served test'], ['a served test'], ['a served test']],
              unknown: undefined,
            }),
        ),
      ),
    )
  })
