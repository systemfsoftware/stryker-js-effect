import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'

import type { VmPluginHost } from '../session-plugin.js'
import { VM_VITEST_BAG_KEY, type VmProjectConfig, type VmVitestRuntime } from '../vitest-host/runtime.js'

export const vitestRuntimeOf = (host: VmPluginHost): VmVitestRuntime => {
  const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
  if (runtime === undefined) {
    throw new Error(
      `no resolved Vitest runtime is stored under the "${VM_VITEST_BAG_KEY}" bag key; the vitest-config plugin must run first`,
    )
  }
  return runtime
}

export const projectForFile = (host: VmPluginHost, file: string): VmProjectConfig =>
  vitestRuntimeOf(host).projectFor(file)

const pathServices = new WeakMap<VmPluginHost, Path.Path>()

export const pathOf = (host: VmPluginHost): Path.Path => {
  const cached = pathServices.get(host)
  if (cached !== undefined) return cached
  const service = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)))
  pathServices.set(host, service)
  return service
}
