import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { EffectAdapter, Registry, Sandbox } from '@systemfsoftware/stryker-vm-harness'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
const nodeRegisterHooks = globalThis.process.getBuiltinModule('node:module').registerHooks
const trackedBuiltin = (events: string[]): Sandbox.HarnessModuleBuiltin => ({
  registerHooks: (hooks) => {
    events.push('register')
    const registered = nodeRegisterHooks(hooks)
    return {
      deregister: () => {
        events.push('deregister')
        registered.deregister()
      },
    }
  },
})
const Feature = makeFeature({ it, layer })

const VITEST_PACKAGE = 'vitest'
const VITEST_HARNESS_ADDRESS = Sandbox.harnessUrlForSpecifier(VITEST_PACKAGE) ?? 'vmrunner-harness:vitest'

interface ServedModule {
  readonly describe: (name: string, body: () => void) => void
  readonly it: (name: string, body: () => void) => void
}

const harnessSource = (address: string): string => {
  const source = Sandbox.harnessSourceFor(address)
  if (source === undefined) {
    throw new Error(`no module is served for "${address}"`)
  }
  return source
}

const servedModuleFor = (address: string, salt: string): Effect.Effect<ServedModule> =>
  Effect.promise(() => Sandbox.nativeImport<ServedModule>(`${address}?salt=${encodeURIComponent(salt)}`))

interface DeclaredTest {
  readonly name: string
}

interface SandboxRegistry {
  readonly suites: ReadonlyMap<number, { readonly name: string }>
  readonly tests: readonly DeclaredTest[]
}
const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const noopSandboxOf = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.writeFileString(path.join(directory, 'noop.js'), '')
    yield* fs.symlink(
      decodeURIComponent(new URL('../node_modules', import.meta.url).pathname),
      path.join(directory, 'node_modules'),
    )
    return directory
  }).pipe(Effect.orDie)

const noPluginRuntime = (directory: string): Sandbox.InterceptionRuntime => ({
  host: {
    sandboxWorkingDirectory: directory,
    options: { sandboxWorkingDirectory: directory, testFiles: [] },
    state: {
      read: () => undefined,
      write: () => undefined,
    },
    resolveVitest: () => ({ expect: {}, vi: undefined }),
    resolveVitestModule: (): string => `file://${directory}/noop.js`,
    importFile: () => Promise.resolve(undefined),
  },
  plugins: [],
})

interface SandboxRun {
  readonly directory: string
  readonly prefix: string
  readonly registry: SandboxRegistry
  readonly state: Sandbox.VmRunnerGlobalState
  readonly suiteName: string
  readonly testName: string
}

const sandboxRunFor = (prefix: string, suiteName: string, testName: string, directory: string): SandboxRun => {
  const registry = Registry.createRegistry()
  const state: Sandbox.VmRunnerGlobalState = {
    api: Registry.createHarnessApi(registry),
    expect,
    vi: undefined,
    effectVitest: undefined,
    projectConfig: undefined,
    provided: registry.provided.current,
  }
  return { directory, prefix, registry, state, suiteName, testName }
}

const sandboxSignal = new AbortController().signal

const releaseSandbox = Effect.sync(() => {
  Sandbox.deactivateSandbox()
  Sandbox.writeGlobalState(undefined)
  Sandbox.uninstallInterception()
})

interface SessionOutcome {
  readonly suiteCount: number
  readonly testNames: readonly string[]
  readonly published: Sandbox.VmRunnerGlobalState | undefined
  readonly afterRelease: Sandbox.VmRunnerGlobalState | undefined
  readonly hookEvents: readonly string[]
}

const runSandboxSession = (run: SandboxRun): Effect.Effect<SessionOutcome> =>
  Effect.gen(function*() {
    const hookEvents: string[] = []
    Sandbox.installInterception(trackedBuiltin(hookEvents), noPluginRuntime(run.directory))
    Sandbox.activateSandbox(run.prefix)
    Sandbox.writeGlobalState(run.state)
    const published = Sandbox.readGlobalState()
    const served = yield* servedModuleFor(VITEST_HARNESS_ADDRESS, run.prefix)
    served.describe(run.suiteName, () => {
      served.it(run.testName, () => undefined)
    })
    const suiteCount = run.registry.suites.size
    const testNames = run.registry.tests.map((registered) => registered.name)
    yield* releaseSandbox
    return { suiteCount, testNames, published, afterRelease: Sandbox.readGlobalState(), hookEvents }
  }).pipe(Effect.ensuring(releaseSandbox))

Feature('Intercepting module resolution for an in-memory sandbox')
  .withScenarioLayer(suiteFileLayer)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'Installing interception and activating a sandbox lets the served runner module register its suites',
      Gherkin.Do.pipe(
        Given('a sandbox run whose registry has recorded nothing yet')(
          'run',
          () =>
            Effect.map(
              noopSandboxOf(),
              (directory) => sandboxRunFor(`file://${directory}/`, 'a declared suite', 'a declared test', directory),
            ),
        ),
        When(
          'interception is installed, the sandbox is activated, and the module served for the vitest package declares a suite',
        )(
          'visited',
          (s) =>
            Effect.gen(function*() {
              const hookEvents: string[] = []
              Sandbox.installInterception(trackedBuiltin(hookEvents), noPluginRuntime(s.run.directory))
              const hooksRegistered = hookEvents.includes('register')
              Sandbox.activateSandbox(s.run.prefix)
              Sandbox.writeGlobalState(s.run.state)
              const published = Sandbox.readGlobalState()
              const served = yield* servedModuleFor(VITEST_HARNESS_ADDRESS, s.run.prefix)
              served.describe(s.run.suiteName, () => {
                served.it(s.run.testName, () => undefined)
              })
              const visited = {
                hooksRegistered,
                published,
                sourceLength: harnessSource(VITEST_HARNESS_ADDRESS).length,
                described: typeof served.describe,
                declared: typeof served.it,
                suiteCount: s.run.registry.suites.size,
                testNames: s.run.registry.tests.map((registered) => registered.name),
              }
              yield* releaseSandbox
              return visited
            }).pipe(Effect.ensuring(releaseSandbox)),
        ),
        Then('the visit registered its hooks, published its state, and the registry holds exactly its suite and test')((
          s,
        ) =>
          Effect.sync(() => {
            expect(s.visited.hooksRegistered).toBe(true)
            expect(s.visited.published).toBe(s.run.state)
            expect(s.visited.sourceLength).toBeGreaterThan(0)
            expect(s.visited.described).toBe('function')
            expect(s.visited.declared).toBe('function')
            expect(s.visited.suiteCount).toBe(1)
            expect(s.visited.testNames).toEqual(['a declared test'])
          })
        ),
      ),
    )

    scenario(
      'Releasing a sandbox clears the published state and deregisters the installed hooks',
      Gherkin.Do.pipe(
        Given('a sandbox run whose hooks can be deregistered')(
          'release',
          () =>
            Effect.gen(function*() {
              const events: string[] = []
              const directory = yield* noopSandboxOf()
              return {
                run: sandboxRunFor(`file://${directory}/`, 'a released suite', 'a released test', directory),
                events,
                builtin: trackedBuiltin(events),
              }
            }),
        ),
        When('interception is installed, the sandbox is activated, and then the run is released')(
          'outcome',
          (s) =>
            Effect.sync(() => {
              Sandbox.installInterception(s.release.builtin, noPluginRuntime(s.release.run.directory))
              Sandbox.activateSandbox(s.release.run.prefix)
              Sandbox.writeGlobalState(s.release.run.state)
              const whileActive = Sandbox.readGlobalState()
              Sandbox.deactivateSandbox()
              Sandbox.writeGlobalState(undefined)
              Sandbox.uninstallInterception()
              return { whileActive, afterRelease: Sandbox.readGlobalState() }
            }),
        ),
        Then('nothing stays published and the installed hooks were deregistered')((s) =>
          Effect.sync(() => {
            expect(s.outcome.whileActive).toBe(s.release.run.state)
            expect(s.outcome.afterRelease).toBeUndefined()
            expect(s.release.events).toEqual(['register', 'deregister'])
          })
        ),
      ),
    )

    scenario(
      'Two sandbox sessions in sequence each intercept only their own run',
      Gherkin.Do.pipe(
        Given('two sandbox runs, each with its own prefix, registry, and published state')(
          'runs',
          () =>
            Effect.gen(function*() {
              const firstDirectory = yield* noopSandboxOf()
              const secondDirectory = yield* noopSandboxOf()
              return {
                first: sandboxRunFor(`file://${firstDirectory}/`, 'the first suite', 'the first test', firstDirectory),
                second: sandboxRunFor(
                  `file://${secondDirectory}/`,
                  'the second suite',
                  'the second test',
                  secondDirectory,
                ),
              }
            }),
        ),
        When('each session is installed, activated, loaded, and released in turn')(
          'sessions',
          (s) =>
            Effect.gen(function*() {
              return {
                first: yield* runSandboxSession(s.runs.first),
                second: yield* runSandboxSession(s.runs.second),
              }
            }),
        ),
        Then('each run holds only its own suite and neither stays published')((s) =>
          Effect.sync(() => {
            expect(s.sessions.first.suiteCount).toBe(1)
            expect(s.sessions.first.testNames).toEqual(['the first test'])
            expect(s.sessions.first.published).toBe(s.runs.first.state)
            expect(s.sessions.first.afterRelease).toBeUndefined()
            expect(s.sessions.first.hookEvents).toEqual(['register', 'deregister'])

            expect(s.sessions.second.suiteCount).toBe(1)
            expect(s.sessions.second.testNames).toEqual(['the second test'])
            expect(s.sessions.second.published).toBe(s.runs.second.state)
            expect(s.sessions.second.afterRelease).toBeUndefined()
            expect(s.sessions.second.hookEvents).toEqual(['register', 'deregister'])
          })
        ),
      ),
    )

    scenario(
      'Effect test methods register a test and report its outcome through the registry',
      Gherkin.Do.pipe(
        Given('a harness registry exposed through the effect test methods')(
          'harness',
          () =>
            Effect.sync(() => {
              const registry = Registry.createRegistry()
              const api = Registry.createHarnessApi(registry)
              return {
                registry,
                methods: EffectAdapter.makeEffectMethods({
                  api: api.it,
                  describe: api.describe,
                  hooks: api.hooks,
                  tests: registry.tests,
                }),
              }
            }),
        ),
        When(
          'a passing effect test, a failing effect test, a layered test, and two property tests are declared and run',
        )(
          'reported',
          (s) =>
            Effect.gen(function*() {
              const contextOf = (name: string): Registry.HarnessTestContext => {
                const registered = s.harness.registry.tests.find((candidate) => candidate.name === name)
                if (registered === undefined) {
                  throw new Error(`no registered test named "${name}"`)
                }
                return { signal: sandboxSignal, task: registered.task, onTestFinished: () => undefined }
              }
              let passed = false
              s.harness.methods.effect('a passing effect test', () =>
                Effect.sync(() => {
                  passed = true
                }))
              const declaredAfterPass = s.harness.registry.tests.length
              const passName = s.harness.registry.tests[0]?.name
              yield* Effect.promise(() =>
                Promise.resolve(s.harness.registry.tests[0]?.fn?.(contextOf('a passing effect test')))
              )
              s.harness.methods.effect('a failing effect test', () =>
                Effect.fail({ _tag: 'IntentionalFailure', message: 'intentional failure' }))
              const declaredAfterFailure = s.harness.registry.tests.length
              const failure = s.harness.registry.tests[1]
              yield* Effect.promise(() =>
                expect(failure?.fn?.(contextOf('a failing effect test'))).rejects.toThrow('intentional failure')
              )

              class GreetingService
                extends Context.Service<GreetingService, { readonly greet: (name: string) => string }>()(
                  'GreetingService',
                )
              {}

              const GreetingLive = Layer.succeed(
                GreetingService,
                GreetingService.of({
                  greet: (name: string) =>
                    `Hello, ${name}!`,
                }),
              )
              let greeted = false
              s.harness.methods.layer(GreetingLive)('a layered block', (withLayer) => {
                withLayer.effect('greets through the provided service', () =>
                  Effect.gen(function*() {
                    const service = yield* GreetingService
                    expect(service.greet('Stryker')).toBe('Hello, Stryker!')
                    greeted = true
                  }))
              })
              const layered = s.harness.registry.tests.find((registered) =>
                registered.name === 'greets through the provided service'
              )
              yield* Effect.promise(() =>
                Promise.resolve(layered?.fn?.(contextOf('greets through the provided service')))
              )

              s.harness.methods.prop('every sampled number is non-negative', S.Finite, (n: number) => n >= 0)
              const falsified = s.harness.registry.tests.find((registered) =>
                registered.name === 'every sampled number is non-negative'
              )
              yield* Effect.promise(() =>
                expect(falsified?.fn?.(contextOf('every sampled number is non-negative'))).rejects.toThrow(
                  'Property falsified',
                )
              )

              s.harness.methods.prop('every sampled number equals itself', S.Finite, (n: number) => n === n)
              const sound = s.harness.registry.tests.find((registered) =>
                registered.name === 'every sampled number equals itself'
              )
              yield* Effect.promise(() =>
                expect(sound?.fn?.(contextOf('every sampled number equals itself'))).resolves.toBeUndefined()
              )

              return {
                passed,
                passName,
                declaredAfterPass,
                declaredAfterFailure,
                greeted,
                layeredDeclared: layered !== undefined,
                falsifiedDeclared: falsified !== undefined,
              }
            }),
        ),
        Then('the registry carries every declared test and each run reports its own outcome')((s) =>
          Effect.sync(() => {
            expect(s.reported.declaredAfterPass).toBe(1)
            expect(s.reported.passName).toBe('a passing effect test')
            expect(s.reported.passed).toBe(true)
            expect(s.reported.declaredAfterFailure).toBe(2)
            expect(s.reported.layeredDeclared).toBe(true)
            expect(s.reported.greeted).toBe(true)
            expect(s.reported.falsifiedDeclared).toBe(true)
          })
        ),
      ),
    )
  })
