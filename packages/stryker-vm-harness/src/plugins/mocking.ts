import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { guardedVi } from '../assertions.js'
import { cleanModuleUrl, MOCK_GLOBAL_KEY } from '../mock-module.js'
import { createMockRuntime, loadVitestMockerModules, mockAwareVi, type MockRuntime } from '../mocking/index.js'
import type { MockFileScope } from '../mocking/mocker.js'
import { createRequire, dirname, existsSync, fileURLToPath, join, pathToFileURL } from '../mocking/node-builtins.js'
import type { VmGlobals, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'

interface MockingState {
  runtime: MockRuntime | undefined
  readonly hoistableUrls: Set<string>
}

const fileScopeOf = (file: { readonly salt: string; readonly url: string }): MockFileScope => ({
  salt: file.salt,
  url: file.url,
})

const HARNESS_PREFIX = 'vmrunner-harness:'
const HARNESS_SEGMENTS: ReadonlyArray<string> = ['/stryker-vm-harness/dist/', '/vitest/dist/', '/@vitest/']

const UNSANDBOXED_IMPORTER_TESTS: ReadonlyArray<(importerUrl: string) => boolean> = [
  (importerUrl) => importerUrl.length === 0,
  (importerUrl) => importerUrl.startsWith(HARNESS_PREFIX),
  (importerUrl) => HARNESS_SEGMENTS.some((segment) => importerUrl.includes(segment)),
]

const isUnsandboxedImporter = (importerUrl: string): boolean =>
  UNSANDBOXED_IMPORTER_TESTS.some((test) => test(importerUrl))

const normalizeSandboxImporter = (importerUrl: string, sandboxRootUrl: string): string =>
  isUnsandboxedImporter(importerUrl) ? sandboxRootUrl : importerUrl

const RELATIVE_PROBE_SUFFIXES: ReadonlyArray<string> = ['', '.ts', '.tsx']

const existingRelativeUrlOf = (specifier: string, parentUrl: string): Option.Option<string> => {
  if (!specifier.startsWith('.')) {
    return Option.none()
  }
  const directory = dirname(fileURLToPath(cleanModuleUrl(parentUrl)))
  const candidate = RELATIVE_PROBE_SUFFIXES.map((suffix) => join(directory, `${specifier}${suffix}`)).find(
    (joined) => existsSync(joined),
  )
  return Option.map(Option.fromNullishOr(candidate), (joined) => pathToFileURL(joined).href)
}

const resolveFromParent = (specifier: string, parentUrl: string): string =>
  Option.getOrElse(
    existingRelativeUrlOf(specifier, parentUrl),
    () => createRequire(cleanModuleUrl(parentUrl)).resolve(specifier),
  )

const resolveIdOf =
  (vitestRuntime: VmVitestRuntime | undefined, sandboxRootUrl: string) =>
  (specifier: string, importerUrl: string): string => {
    const normalizedImporter = normalizeSandboxImporter(importerUrl, sandboxRootUrl)
    return Option.getOrElse(
      Option.fromNullishOr(vitestRuntime?.resolveIdSync(specifier, cleanModuleUrl(normalizedImporter))),
      () => resolveFromParent(specifier, normalizedImporter),
    )
  }

const projectsOf = (vitestRuntime: VmVitestRuntime | undefined): VmVitestRuntime['config']['projects'] =>
  Option.getOrElse(Option.fromNullishOr(vitestRuntime?.config.projects), () => [])

const addProjectSetupFiles = (state: MockingState, projects: VmVitestRuntime['config']['projects']): void => {
  for (const setupFile of projects.flatMap((project) => project.setupFiles)) {
    state.hoistableUrls.add(cleanModuleUrl(pathToFileURL(setupFile).href))
  }
}

const awaitTransformHost = (vitestRuntime: VmVitestRuntime | undefined, sandboxRootUrl: string): void => {
  vitestRuntime?.resolveIdSync('vitest/package.json', sandboxRootUrl)
}

const initEffect = (host: VmPluginHost, state: MockingState): Effect.Effect<void> =>
  Effect.gen(function*() {
    const vitestRuntime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    const sandboxRootUrl = `${pathToFileURL(host.sandboxWorkingDirectory).href}/`
    awaitTransformHost(vitestRuntime, sandboxRootUrl)
    const modules = yield* Effect.promise(() =>
      loadVitestMockerModules(host.resolveVitestModule('vitest/package.json'))
    )
    state.runtime = createMockRuntime({
      root: host.sandboxWorkingDirectory,
      modules,
      resolveId: resolveIdOf(vitestRuntime, sandboxRootUrl),
      isHoistableUrl: (url: string): boolean => state.hoistableUrls.has(cleanModuleUrl(url)),
    })
    Reflect.set(globalThis, MOCK_GLOBAL_KEY, state.runtime.mocker)
    addProjectSetupFiles(state, projectsOf(vitestRuntime))
  })

export const createMockingPlugin = (): VmSessionPlugin => {
  const state: MockingState = { runtime: undefined, hoistableUrls: new Set<string>() }

  return {
    name: 'mocking',
    init: (host) => Effect.runPromise(initEffect(host, state)),
    beforeFileImport: (file) => {
      state.hoistableUrls.add(cleanModuleUrl(file.url))
      state.runtime?.beginFile(fileScopeOf(file))
    },
    afterFileImport: () => {
      state.runtime?.endFile()
    },
    beforeFileRun: (file) => {
      state.runtime?.beginRun(fileScopeOf(file))
    },
    afterFileRun: () => {
      state.runtime?.endRun()
    },
    resolve: (specifier, context, next) => state.runtime?.resolveStage(specifier, context, next),
    load: (url, context, next) => state.runtime?.loadStage(url, context, next),
    globals: (_file, host): VmGlobals | undefined =>
      Option.fromNullishOr(host.resolveVitest().vi).pipe(
        Option.flatMap((vi) =>
          Option.map(
            Option.fromNullishOr(state.runtime),
            (runtime): VmGlobals => ({ vi: guardedVi(mockAwareVi(vi, runtime.mocker)) }),
          )
        ),
        Option.getOrUndefined,
      ),
  }
}
