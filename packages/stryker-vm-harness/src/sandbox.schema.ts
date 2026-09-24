import type { RegisterHooksOptions } from 'node:module'

import type { HarnessApi } from './registry.schema.js'
import type { VmPluginHost, VmSessionPlugin } from './session-plugin.js'
import type { VmProjectConfig } from './vitest-config.schema.js'

export type RegisterHooksFn = (
  hooks: RegisterHooksOptions,
) => { readonly deregister: () => void } | undefined

export interface HarnessModuleBuiltin {
  readonly registerHooks: RegisterHooksFn
}

export interface InterceptionRuntime {
  readonly host: VmPluginHost
  readonly plugins: readonly VmSessionPlugin[]
}

export interface ActivateSandboxCommand {
  readonly prefix: string
}

export interface InstallInterceptionCommand {
  readonly nodeModule: HarnessModuleBuiltin
  readonly runtime: InterceptionRuntime
}

export type ProvidedValue = object | string | number | boolean | null

export interface EffectVitestSurface<A = unknown> {
  readonly it: A
}

export interface VmRunnerGlobalState {
  readonly api: HarnessApi
  readonly expect: object | undefined
  readonly vi: object | undefined
  readonly effectVitest: EffectVitestSurface | undefined
  readonly projectConfig: VmProjectConfig | undefined
  readonly provided: Record<string, ProvidedValue | undefined>
}
