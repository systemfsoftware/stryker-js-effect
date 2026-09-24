import type {
  LoadFnOutput,
  LoadHookContext,
  LoadHookSync,
  ResolveFnOutput,
  ResolveHookContext,
  ResolveHookSync,
} from 'node:module'

import type { TestRegistry } from '../core/registry.js'
import type { VmRunKind, VmRunRequest, VmRunResponse, VmSessionOptions } from '../core/vm-protocol.schema.js'

export interface VitestModuleNamespace {
  readonly createExpect?: (task: object) => object
  readonly expect: object
  readonly vi: object | undefined
}

export interface VmPluginBag {
  readonly read: <A extends object>(key: string) => A | undefined
  readonly write: <A extends object>(key: string, value: A) => void
}

export interface VmPluginHost {
  readonly sandboxWorkingDirectory: string
  readonly options: VmSessionOptions
  readonly state: VmPluginBag
  readonly resolveVitest: () => VitestModuleNamespace
  readonly resolveVitestModule: (specifier: string) => string
  readonly importFile: (file: string, salt: string) => Promise<void>
}

export interface VmFileContext {
  readonly file: string
  readonly salt: string
  readonly url: string
}

export interface VmGraphContext {
  readonly registry: TestRegistry
  readonly files: readonly string[]
}

export interface VmTestContext {
  readonly id: string
  readonly name: string
  readonly file: string
  readonly runKind: VmRunKind
}

export interface VmTestOutcome {
  readonly status: 'success' | 'failed' | 'skipped'
  readonly failureMessage: string | undefined
}

export interface VmRunContext {
  readonly request: VmRunRequest
  readonly graph: VmGraphContext | undefined
  readonly response: VmRunResponse
}

export interface VmStageArgs {
  readonly init: readonly [VmPluginHost]
  readonly beforeGraphLoad: readonly [VmGraphContext, VmPluginHost]
  readonly disposeGraph: readonly [VmGraphContext, VmPluginHost]
  readonly beforeFileImport: readonly [VmFileContext, VmPluginHost]
  readonly afterFileImport: readonly [VmFileContext, VmPluginHost]
  readonly beforeFileRun: readonly [VmFileContext, VmPluginHost]
  readonly afterFileRun: readonly [VmFileContext, VmPluginHost]
  readonly beforeTest: readonly [VmTestContext, VmPluginHost]
  readonly afterTest: readonly [VmTestContext, VmTestOutcome, VmPluginHost]
  readonly afterRun: readonly [VmRunContext, VmPluginHost]
  readonly dispose: readonly [VmPluginHost]
}

export type VmStageName = keyof VmStageArgs

export const VM_TEST_FILES_BAG_KEY = 'vitest:testFiles'

export interface VmDiscoveredTestFiles {
  readonly files: readonly string[]
}

export type VmResolveStage = (
  specifier: string,
  context: Parameters<ResolveHookSync>[1],
  next: ResolveHookSync,
  host: VmPluginHost,
) => ResolveFnOutput | undefined

export type VmLoadStage = (
  url: string,
  context: Parameters<LoadHookSync>[1],
  next: LoadHookSync,
  host: VmPluginHost,
) => LoadFnOutput | undefined

export type VmGlobals = Record<string, string | number | boolean | object>

export type VmGlobalsStage = (file: string, host: VmPluginHost) => VmGlobals | undefined

export interface VmSessionPlugin {
  readonly name: string
  readonly init?: (host: VmPluginHost) => void | Promise<void>
  readonly beforeGraphLoad?: (graph: VmGraphContext, host: VmPluginHost) => void | Promise<void>
  readonly disposeGraph?: (graph: VmGraphContext, host: VmPluginHost) => void | Promise<void>
  readonly beforeFileImport?: (file: VmFileContext, host: VmPluginHost) => void | Promise<void>
  readonly afterFileImport?: (file: VmFileContext, host: VmPluginHost) => void | Promise<void>
  readonly beforeFileRun?: (file: VmFileContext, host: VmPluginHost) => void | Promise<void>
  readonly afterFileRun?: (file: VmFileContext, host: VmPluginHost) => void | Promise<void>
  readonly beforeTest?: (test: VmTestContext, host: VmPluginHost) => void | Promise<void>
  readonly afterTest?: (test: VmTestContext, outcome: VmTestOutcome, host: VmPluginHost) => void | Promise<void>
  readonly afterRun?: (run: VmRunContext, host: VmPluginHost) => void | Promise<void>
  readonly dispose?: (host: VmPluginHost) => void | Promise<void>
  readonly resolve?: VmResolveStage
  readonly load?: VmLoadStage
  readonly globals?: VmGlobalsStage
}

export const runStage = <K extends VmStageName>(
  plugins: readonly VmSessionPlugin[],
  stage: K,
  ...args: VmStageArgs[K]
): Promise<void> => {
  const steps: Array<() => void | Promise<void>> = []
  for (const plugin of plugins) {
    const hook = plugin[stage] as ((...hookArgs: VmStageArgs[K]) => void | Promise<void>) | undefined
    if (hook !== undefined) {
      steps.push(() => hook(...args))
    }
  }
  return steps.reduce<Promise<void>>((pending, step) => pending.then(() => step()), Promise.resolve())
}

export type VmResolveTerminal = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput

export type VmLoadTerminal = (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput

export const runResolveStage = (
  plugins: readonly VmSessionPlugin[],
  host: VmPluginHost,
  specifier: string,
  context: Parameters<ResolveHookSync>[1],
  terminal: VmResolveTerminal,
): ResolveFnOutput => {
  const from = (index: number): ResolveHookSync => (nextSpecifier, nextContext) => {
    const plugin = plugins[index]
    if (plugin === undefined) {
      return terminal(nextSpecifier, nextContext)
    }
    const rest = from(index + 1)
    return plugin.resolve?.(nextSpecifier, nextContext, rest, host) ?? rest(nextSpecifier, nextContext, terminal)
  }
  return from(0)(specifier, context, terminal)
}

export const runLoadStage = (
  plugins: readonly VmSessionPlugin[],
  host: VmPluginHost,
  url: string,
  context: Parameters<LoadHookSync>[1],
  terminal: VmLoadTerminal,
): LoadFnOutput => {
  const from = (index: number): LoadHookSync => (nextUrl, nextContext) => {
    const plugin = plugins[index]
    if (plugin === undefined) {
      return terminal(nextUrl, nextContext)
    }
    const rest = from(index + 1)
    return plugin.load?.(nextUrl, nextContext, rest, host) ?? rest(nextUrl, nextContext, terminal)
  }
  return from(0)(url, context, terminal)
}
