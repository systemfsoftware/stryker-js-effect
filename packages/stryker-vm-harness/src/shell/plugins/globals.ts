import { pathOf, projectForFile } from '../environments/file-config.js'
import { installGlobalValues, type PriorDescriptors, restoreDescriptors } from '../environments/global-descriptors.js'
import {
  GLOBAL_API_NAMES,
  harnessGlobalBindings,
  type HarnessGlobalSources,
  type VitestNamespaceSurface,
} from '../environments/harness-globals.js'
import { loadVitestNamespace } from '../environments/vitest-runtime-modules.js'
import { readGlobalState } from '../global-state.js'
import type { VmFileContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'

const PLUGIN_NAME = 'globals'

const originals = new WeakMap<VmPluginHost, PriorDescriptors>()
const namespaces = new WeakMap<VmPluginHost, Promise<VitestNamespaceSurface>>()

const namespaceFor = (host: VmPluginHost): Promise<VitestNamespaceSurface> => {
  const cached = namespaces.get(host)
  if (cached !== undefined) return cached
  const loaded = loadVitestNamespace(host.resolveVitestModule('vitest/package.json'), pathOf(host))
  namespaces.set(host, loaded)
  return loaded
}

const sourcesFor = (host: VmPluginHost): Promise<HarnessGlobalSources> =>
  namespaceFor(host).then((vitest: VitestNamespaceSurface) => {
    const state = readGlobalState()
    if (state === undefined) {
      throw new Error(
        'no harness state is published for the sandbox; the session must publish it before importing a test file',
      )
    }
    const sources: HarnessGlobalSources = { api: state.api, expect: state.expect, vi: state.vi, vitest }
    return sources
  })

const installFor = (host: VmPluginHost): Promise<void> => {
  if (originals.has(host)) return Promise.resolve()
  return sourcesFor(host).then((sources) => {
    const bindings = harnessGlobalBindings(sources)
    const entries = GLOBAL_API_NAMES.flatMap((name) => {
      const value = bindings[name]
      return value === undefined ? [] : [[name, value] as const]
    })
    originals.set(host, installGlobalValues(globalThis, entries))
  })
}

const restoreFor = (host: VmPluginHost): void => {
  const recorded = originals.get(host)
  if (recorded === undefined) return
  originals.delete(host)
  restoreDescriptors(globalThis, recorded)
}

const installWhenRequested = (host: VmPluginHost, file: VmFileContext): Promise<void> => {
  if (!projectForFile(host, file.file).globals) return Promise.resolve()
  return installFor(host)
}

export const globalsPlugin: VmSessionPlugin = {
  name: PLUGIN_NAME,
  beforeFileImport: (file, host) => installWhenRequested(host, file),
  afterFileImport: (_file, host) => {
    restoreFor(host)
  },
  beforeFileRun: (file, host) => installWhenRequested(host, file),
  afterFileRun: (_file, host) => {
    restoreFor(host)
  },
}
