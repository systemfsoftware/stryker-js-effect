import type { VmDiscoveredTestFiles, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { VM_TEST_FILES_BAG_KEY } from '../session-plugin.js'
import { createVmVitestRuntime, type VmVitestHostHandle } from '../vitest-host/bridge.js'
import { existsSync, join } from '../vitest-host/node-builtins.js'
import { VM_VITEST_BAG_KEY } from '../vitest-host/runtime.js'
import type { VmSessionOptions } from '../vm-protocol.schema.js'

const BROWSER_MODE_MESSAGE =
  "The in-memory 'vm' runner cannot run Vitest browser mode suites. Use testRunner: 'vitest' for suites that need browser mode."
const CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
]

const configFileFor = (options: VmSessionOptions): string | undefined => {
  if (options.configFile !== undefined) {
    return options.configFile
  }
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(options.sandboxWorkingDirectory, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

export const createVitestConfigPlugin = (): VmSessionPlugin => {
  const handles = new WeakMap<VmPluginHost, VmVitestHostHandle>()
  return {
    name: 'vitest-config',
    init: (host: VmPluginHost): Promise<void> => {
      Reflect.defineProperty(globalThis, '__vitest_index__', {
        value: host.resolveVitest(),
        enumerable: false,
        configurable: true,
      })
      let handle: VmVitestHostHandle
      try {
        handle = createVmVitestRuntime({
          sandboxWorkingDirectory: host.sandboxWorkingDirectory,
          configFile: configFileFor(host.options),
        })
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes('browser')) {
          return Promise.reject(new Error(BROWSER_MODE_MESSAGE))
        }
        throw error
      }
      if (handle.runtime.config.browser) {
        handles.delete(host)
        return handle.close().then(
          (): void => {
            throw new Error(BROWSER_MODE_MESSAGE)
          },
        )
      }
      handles.set(host, handle)
      host.state.write(VM_VITEST_BAG_KEY, handle.runtime)
      return handle.listTestFiles().then((files) => {
        const discovered: VmDiscoveredTestFiles = { files: [...files] }
        host.state.write(VM_TEST_FILES_BAG_KEY, discovered)
      })
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
