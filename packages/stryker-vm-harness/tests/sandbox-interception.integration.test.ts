import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { EffectAdapter, Registry, Sandbox } from '@systemfsoftware/stryker-vm-harness'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
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
const Feature = makeFeature({ it })

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

const quietExpect = (value: object): object => value

const sandboxRunFor = (prefix: string, suiteName: string, testName: string, directory: string): SandboxRun => {
  const registry = Registry.createRegistry()
  const state: Sandbox.VmRunnerGlobalState = {
    api: Registry.createHarnessApi(registry),
    expect: quietExpect,
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
  .live('the interception installs real node loader hooks and loads served modules over them')
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
          expect,
        ) =>
          expect({
            hooksRegistered: s.visited.hooksRegistered,
            publishedIsState: Object.is(s.visited.published, s.run.state),
            sourcePresent: s.visited.sourceLength > 0,
            described: s.visited.described,
            declared: s.visited.declared,
            suiteCount: s.visited.suiteCount,
            testNames: s.visited.testNames,
          }).toEqual({
            hooksRegistered: true,
            publishedIsState: true,
            sourcePresent: true,
            described: 'function',
            declared: 'function',
            suiteCount: 1,
            testNames: ['a declared test'],
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
        Then('nothing stays published and the installed hooks were deregistered')((s, expect) =>
          expect({
            whileActiveIsState: Object.is(s.outcome.whileActive, s.release.run.state),
            afterRelease: s.outcome.afterRelease,
            events: s.release.events,
          }).toEqual({ whileActiveIsState: true, afterRelease: undefined, events: ['register', 'deregister'] })
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
        Then('each run holds only its own suite and neither stays published')((s, expect) =>
          expect({
            first: {
              suiteCount: s.sessions.first.suiteCount,
              testNames: s.sessions.first.testNames,
              publishedIsState: Object.is(s.sessions.first.published, s.runs.first.state),
              afterRelease: s.sessions.first.afterRelease,
              hookEvents: s.sessions.first.hookEvents,
            },
            second: {
              suiteCount: s.sessions.second.suiteCount,
              testNames: s.sessions.second.testNames,
              publishedIsState: Object.is(s.sessions.second.published, s.runs.second.state),
              afterRelease: s.sessions.second.afterRelease,
              hookEvents: s.sessions.second.hookEvents,
            },
          }).toEqual({
            first: {
              suiteCount: 1,
              testNames: ['the first test'],
              publishedIsState: true,
              afterRelease: undefined,
              hookEvents: ['register', 'deregister'],
            },
            second: {
              suiteCount: 1,
              testNames: ['the second test'],
              publishedIsState: true,
              afterRelease: undefined,
              hookEvents: ['register', 'deregister'],
            },
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
              const outcomeOfRun = (name: string): Promise<string> =>
                Promise.resolve(
                  s.harness.registry.tests.find((candidate) => candidate.name === name)?.fn?.(contextOf(name)),
                ).then(
                  (value) => (value === undefined ? 'undefined' : 'non-undefined'),
                  (cause: Error) => cause.message,
                )
              let passed = false
              s.harness.methods.effect('a passing effect test', () =>
                Effect.sync(() => {
                  passed = true
                }))
              const declaredAfterPass = s.harness.registry.tests.length
              const passName = s.harness.registry.tests[0]?.name
              yield* Effect.promise(() => outcomeOfRun('a passing effect test'))
              s.harness.methods.effect('a failing effect test', () =>
                Effect.fail({ _tag: 'IntentionalFailure', message: 'intentional failure' }))
              const declaredAfterFailure = s.harness.registry.tests.length
              const failureMessage = yield* Effect.promise(() =>
                outcomeOfRun('a failing effect test')
              )

              class GreetingService
                extends Context.Service<GreetingService, { readonly greet: (name: string) => string }>()(
                  'GreetingService',
                )
              {}

              const GreetingLive = Layer.succeed(
                GreetingService,
                GreetingService.of({
                  greet: (name: string) => `Hello, ${name}!`,
                }),
              )
              let greeted = false
              let greetResult: string | undefined
              s.harness.methods.layer(GreetingLive)('a layered block', (withLayer) => {
                withLayer.effect('greets through the provided service', () =>
                  Effect.gen(function*() {
                    const service = yield* GreetingService
                    greetResult = service.greet('Stryker')
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
              const falsifiedMessage = yield* Effect.promise(() => outcomeOfRun('every sampled number is non-negative'))

              s.harness.methods.prop('every sampled number equals itself', S.Finite, (n: number) => n === n)
              const soundOutcome = yield* Effect.promise(() => outcomeOfRun('every sampled number equals itself'))

              return {
                passed,
                passName,
                declaredAfterPass,
                declaredAfterFailure,
                greeted,
                greetResult,
                layeredDeclared: layered !== undefined,
                falsifiedDeclared: falsified !== undefined,
                failureMessage,
                falsifiedMessage,
                soundOutcome,
              }
            }),
        ),
        Then('the registry carries every declared test and each run reports its own outcome')((s, expect) =>
          expect({
            declaredAfterPass: s.reported.declaredAfterPass,
            passName: s.reported.passName,
            passed: s.reported.passed,
            declaredAfterFailure: s.reported.declaredAfterFailure,
            layeredDeclared: s.reported.layeredDeclared,
            greeted: s.reported.greeted,
            greetResult: s.reported.greetResult,
            falsifiedDeclared: s.reported.falsifiedDeclared,
            refusalNamesFailure: s.reported.failureMessage.includes('intentional failure'),
            falsificationNamesProperty: s.reported.falsifiedMessage.includes('Property falsified'),
            soundOutcome: s.reported.soundOutcome,
          }).toEqual({
            declaredAfterPass: 1,
            passName: 'a passing effect test',
            passed: true,
            declaredAfterFailure: 2,
            layeredDeclared: true,
            greeted: true,
            greetResult: 'Hello, Stryker!',
            falsifiedDeclared: true,
            refusalNamesFailure: true,
            falsificationNamesProperty: true,
            soundOutcome: 'undefined',
          })
        ),
      ),
    )
  })
