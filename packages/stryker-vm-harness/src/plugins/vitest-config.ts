import type { VmDiscoveredTestFiles, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { VM_TEST_FILES_BAG_KEY } from '../session-plugin.js'
import { createVmVitestRuntime, type VmVitestHostHandle } from '../vitest-host/bridge.js'
import { existsSync, join } from '../vitest-host/node-builtins.js'
import { VM_VITEST_BAG_KEY } from '../vitest-host/runtime.js'
import type { VmSessionOptions } from '../vm-protocol.schema.js'

type AnyDecoded<A = unknown> = A

const BROWSER_MODE_MESSAGE =
  "The in-memory 'vm' runner cannot run Vitest browser mode suites. Use testRunner: 'vitest' for suites that need browser mode."
const BROWSER_MODE_MARKER = 'browser'
const CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
]

const configFileIn = (directory: string, name: string): string | undefined => {
  const candidate = join(directory, name)
  return existsSync(candidate) ? candidate : undefined
}

const existingConfigFile = (directory: string): string | undefined =>
  CONFIG_FILE_NAMES.map((name) => configFileIn(directory, name)).find((candidate) => candidate !== undefined)

const configFileFor = (options: VmSessionOptions): string | undefined =>
  options.configFile ?? existingConfigFile(options.sandboxWorkingDirectory)

const isBrowserError = (error: AnyDecoded): boolean =>
  error instanceof Error && error.message.toLowerCase().includes(BROWSER_MODE_MARKER)

const browserRefusal = (error: AnyDecoded): Promise<never> => {
  if (isBrowserError(error)) {
    return Promise.reject(new Error(BROWSER_MODE_MESSAGE))
  }
  throw error
}

const startRuntime = (host: VmPluginHost): Promise<VmVitestHostHandle> => {
  try {
    return Promise.resolve(
      createVmVitestRuntime({
        sandboxWorkingDirectory: host.sandboxWorkingDirectory,
        configFile: configFileFor(host.options),
      }),
    )
  } catch (error) {
    return browserRefusal(error)
  }
}

export const createVitestConfigPlugin = (): VmSessionPlugin => {
  const handles = new WeakMap<VmPluginHost, VmVitestHostHandle>()

  const defineVitestIndex = (host: VmPluginHost): void => {
    Reflect.defineProperty(globalThis, '__vitest_index__', {
      value: host.resolveVitest(),
      enumerable: false,
      configurable: true,
    })
  }

  const refuseBrowser = (host: VmPluginHost, handle: VmVitestHostHandle): Promise<void> => {
    handles.delete(host)
    return handle.close().then(
      (): void => {
        throw new Error(BROWSER_MODE_MESSAGE)
      },
    )
  }

  const activate = (host: VmPluginHost, handle: VmVitestHostHandle): Promise<void> => {
    if (handle.runtime.config.browser) {
      return refuseBrowser(host, handle)
    }
    handles.set(host, handle)
    host.state.write(VM_VITEST_BAG_KEY, handle.runtime)
    return handle.listTestFiles().then((files) => {
      const discovered: VmDiscoveredTestFiles = { files: [...files] }
      host.state.write(VM_TEST_FILES_BAG_KEY, discovered)
    })
  }

  return {
    name: 'vitest-config',
    init: (host: VmPluginHost): Promise<void> => {
      defineVitestIndex(host)
      return startRuntime(host).then((handle) => activate(host, handle))
    },
    dispose: (host: VmPluginHost): Promise<void> => {
      const handle = handles.get(host)
      if (handle === undefined) return Promise.resolve()
      handles.delete(host)
      return handle.close()
    },
  }
}

export const vitestConfigPlugin: VmSessionPlugin = createVitestConfigPlugin()
