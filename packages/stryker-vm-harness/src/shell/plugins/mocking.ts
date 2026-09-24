import * as Effect from 'effect/Effect'

import { guardedVi } from '../../core/guards.js'
import { cleanModuleUrl, MOCK_GLOBAL_KEY } from '../../core/mock-module.js'
import { createMockRuntime, loadVitestMockerModules, mockAwareVi, type MockRuntime } from '../mocking/index.js'
import type { MockFileScope } from '../mocking/mocker.js'
import { createRequire, dirname, existsSync, fileURLToPath, join, pathToFileURL } from '../mocking/node-builtins.js'
import type { VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'

const mockerHost = globalThis as typeof globalThis & Record<typeof MOCK_GLOBAL_KEY, object>

interface MockingState {
  runtime: MockRuntime | undefined
  readonly hoistableUrls: Set<string>
}

const fileScopeOf = (file: { readonly salt: string; readonly url: string }): MockFileScope => ({
  salt: file.salt,
  url: file.url,
})

const VITEST_CHUNK_PREFIXES: ReadonlyArray<string> = ['/vitest/dist/', '/@vitest/']

const normalizeSandboxImporter = (importerUrl: string, sandboxRootUrl: string): string => {
  if (importerUrl.length === 0 || importerUrl.startsWith('vmrunner-harness:')) {
    return sandboxRootUrl
  }
  if (
    importerUrl.includes('/stryker-vm-harness/dist/') ||
    VITEST_CHUNK_PREFIXES.some((prefix) => importerUrl.includes(prefix))
  ) {
    return sandboxRootUrl
  }
  return importerUrl
}

const resolveFromParent = (specifier: string, parentUrl: string): string => {
  if (specifier.startsWith('.')) {
    const directory = dirname(fileURLToPath(cleanModuleUrl(parentUrl)))
    for (const probe of [specifier, `${specifier}.ts`, `${specifier}.tsx`]) {
      const candidate = join(directory, probe)
      if (existsSync(candidate)) {
        return pathToFileURL(candidate).href
      }
    }
  }
  return createRequire(cleanModuleUrl(parentUrl)).resolve(specifier)
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
      resolveId: (specifier: string, importerUrl: string): string => {
        const normalizedImporter = normalizeSandboxImporter(importerUrl, sandboxRootUrl)
        const throughVite = vitestRuntime?.resolveIdSync(specifier, cleanModuleUrl(normalizedImporter))
        if (throughVite !== undefined) {
          return throughVite
        }
        return resolveFromParent(specifier, normalizedImporter)
      },
      isHoistableUrl: (url: string): boolean => state.hoistableUrls.has(cleanModuleUrl(url)),
    })
    mockerHost[MOCK_GLOBAL_KEY] = state.runtime.mocker
    for (const project of vitestRuntime?.config.projects ?? []) {
      for (const setupFile of project.setupFiles) {
        state.hoistableUrls.add(cleanModuleUrl(pathToFileURL(setupFile).href))
      }
    }
  })

const awaitTransformHost = (vitestRuntime: VmVitestRuntime | undefined, sandboxRootUrl: string): void => {
  vitestRuntime?.resolveIdSync('vitest/package.json', sandboxRootUrl)
}

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
    globals: (_file, host) => {
      const realVi = host.resolveVitest().vi
      if (realVi === undefined || state.runtime === undefined) {
        return undefined
      }
      return { vi: guardedVi(mockAwareVi(realVi, state.runtime.mocker)) }
    },
  }
}
