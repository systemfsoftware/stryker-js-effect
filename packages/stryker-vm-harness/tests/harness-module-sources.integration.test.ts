import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  activateSandbox,
  createHarnessApi,
  createRegistry,
  deactivateSandbox,
  type HarnessModuleBuiltin,
  harnessSourceFor,
  harnessUrlForSpecifier,
  installInterception,
  type InterceptionRuntime,
  makeEffectMethods,
  nativeImport,
  readGlobalState,
  uninstallInterception,
  type VmRunnerGlobalState,
  writeGlobalState,
} from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const FIRST_PARTY_PACKAGES = [
  'vitest',
  '@effect/vitest',
  '@systemfsoftware/effect-gherkin-spec',
] as const
const EXPECTED_SURFACE = ['describe', 'it', 'test', 'beforeEach', 'expect'] as const

const nodeRegisterHooks = globalThis.process.getBuiltinModule('node:module').registerHooks

const liveBuiltin: HarnessModuleBuiltin = {
  registerHooks: (hooks) => {
    const registered = nodeRegisterHooks(hooks)
    return { deregister: () => registered.deregister() }
  },
}

const quietRuntime = (): InterceptionRuntime => ({
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
  deactivateSandbox()
  writeGlobalState(undefined)
  uninstallInterception()
})

const loadServedModule = (packageName: string): Effect.Effect<ServedModuleReport> =>
  Effect.gen(function*() {
    const address = harnessUrlForSpecifier(packageName)
    if (address === undefined) {
      throw new Error(`no module is served for "${packageName}"`)
    }
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const state: VmRunnerGlobalState = {
      api,
      expect,
      vi: undefined,
      effectVitest: {
        it: makeEffectMethods({ api: api.it, describe: api.describe, hooks: api.hooks, tests: registry.tests }),
      },
      projectConfig: undefined,
      provided: registry.provided.current,
    }
    installInterception(liveBuiltin, quietRuntime())
    activateSandbox(sandboxPrefix)
    writeGlobalState(state)
    try {
      const served = yield* Effect.promise(() =>
        nativeImport<Partial<ServedRunnerModule>>(`${address}?salt=${encodeURIComponent(sandboxPrefix)}`)
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
      const published = readGlobalState()
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
              vitest: harnessUrlForSpecifier(s.packages.served[0]),
              effectVitest: harnessUrlForSpecifier(s.packages.served[1]),
              gherkin: harnessUrlForSpecifier(s.packages.served[2]),
              unserved: harnessUrlForSpecifier(s.packages.unserved),
            }),
        ),
        Then('the served packages map to their own harness addresses and the unserved one maps to nothing')((s) => {
          expect(s.addresses.vitest).toBe('vmrunner-harness:vitest')
          expect(s.addresses.effectVitest).toBe('vmrunner-harness:@effect/vitest')
          expect(s.addresses.gherkin).toBe('vmrunner-harness:@systemfsoftware/effect-gherkin-spec')
          expect(s.addresses.unserved).toBeUndefined()
        }),
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
              return { loaded, unknown: harnessSourceFor('unknown-url') }
            }),
        ),
        Then('every module carries the registration surface, registers its suite, and no unknown address serves')((
          s,
        ) => {
          expect(s.served.loaded.map((entry) => entry.address)).toEqual([
            'vmrunner-harness:vitest',
            'vmrunner-harness:@effect/vitest',
            'vmrunner-harness:@systemfsoftware/effect-gherkin-spec',
          ])
          for (const entry of s.served.loaded) {
            expect(entry.surface).toEqual([...EXPECTED_SURFACE])
            expect(entry.registered).toEqual(['a served test'])
          }
          expect(s.served.unknown).toBeUndefined()
        }),
      ),
    )
  })
