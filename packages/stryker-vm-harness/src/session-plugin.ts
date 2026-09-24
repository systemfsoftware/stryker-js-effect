import { dual } from 'effect/Function'

import type { TestRegistry } from './registry.schema.js'
import type { VmRunKind, VmRunRequest, VmRunResponse, VmSessionOptions } from './vm-protocol.schema.js'

const moduleBuiltin = globalThis.process.getBuiltinModule('node:module')

type ModuleBuiltin = typeof moduleBuiltin
type RegisterHooksOptions = Parameters<ModuleBuiltin['registerHooks']>[0]

export type ResolveHookSync = NonNullable<RegisterHooksOptions['resolve']>
export type LoadHookSync = NonNullable<RegisterHooksOptions['load']>
export type ResolveFnOutput = ReturnType<ResolveHookSync>
export type LoadFnOutput = ReturnType<LoadHookSync>
export type ResolveHookContext = Parameters<ResolveHookSync>[1]
export type LoadHookContext = Parameters<LoadHookSync>[1]

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

type StageInvoker<K extends VmStageName> = (
  plugin: VmSessionPlugin,
  args: VmStageArgs[K],
) => void | Promise<void> | undefined

const STAGE_INVOKERS: { readonly [K in VmStageName]: StageInvoker<K> } = {
  init: (plugin, args) => plugin.init?.(...args),
  beforeGraphLoad: (plugin, args) => plugin.beforeGraphLoad?.(...args),
  disposeGraph: (plugin, args) => plugin.disposeGraph?.(...args),
  beforeFileImport: (plugin, args) => plugin.beforeFileImport?.(...args),
  afterFileImport: (plugin, args) => plugin.afterFileImport?.(...args),
  beforeFileRun: (plugin, args) => plugin.beforeFileRun?.(...args),
  afterFileRun: (plugin, args) => plugin.afterFileRun?.(...args),
  beforeTest: (plugin, args) => plugin.beforeTest?.(...args),
  afterTest: (plugin, args) => plugin.afterTest?.(...args),
  afterRun: (plugin, args) => plugin.afterRun?.(...args),
  dispose: (plugin, args) => plugin.dispose?.(...args),
}

export const runStage = <K extends VmStageName>(
  plugins: readonly VmSessionPlugin[],
  stage: K,
  ...args: VmStageArgs[K]
): Promise<void> => {
  const invoke = STAGE_INVOKERS[stage]
  return plugins.reduce<Promise<void>>((pending, plugin) => pending.then(() => invoke(plugin, args)), Promise.resolve())
}

export type VmResolveTerminal = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput

export type VmLoadTerminal = (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput

const resolveHookOutputOf = (
  plugin: VmSessionPlugin,
  specifier: string,
  context: ResolveHookContext,
  rest: ResolveHookSync,
  host: VmPluginHost,
): ResolveFnOutput | undefined => plugin.resolve?.(specifier, context, rest, host)

const resolveThroughPlugin = (
  plugin: VmSessionPlugin,
  specifier: string,
  context: ResolveHookContext,
  rest: ResolveHookSync,
  host: VmPluginHost,
  terminal: VmResolveTerminal,
): ResolveFnOutput => resolveHookOutputOf(plugin, specifier, context, rest, host) ?? rest(specifier, context, terminal)

const resolveStepAt = (
  plugins: readonly VmSessionPlugin[],
  host: VmPluginHost,
  terminal: VmResolveTerminal,
  restOf: (index: number) => ResolveHookSync,
  index: number,
  specifier: string,
  context: ResolveHookContext,
): ResolveFnOutput => {
  const plugin = plugins[index]
  return plugin === undefined
    ? terminal(specifier, context)
    : resolveThroughPlugin(plugin, specifier, context, restOf(index + 1), host, terminal)
}

export const runResolveStage = dual<
  (
    host: VmPluginHost,
    specifier: string,
    context: ResolveHookContext,
    terminal: VmResolveTerminal,
  ) => (plugins: readonly VmSessionPlugin[]) => ResolveFnOutput,
  (
    plugins: readonly VmSessionPlugin[],
    host: VmPluginHost,
    specifier: string,
    context: ResolveHookContext,
    terminal: VmResolveTerminal,
  ) => ResolveFnOutput
>(5, (plugins, host, specifier, context, terminal): ResolveFnOutput => {
  const restOf = (index: number): ResolveHookSync => (nextSpecifier, nextContext) =>
    resolveStepAt(plugins, host, terminal, restOf, index, nextSpecifier, nextContext)
  return restOf(0)(specifier, context, terminal)
})

const loadHookOutputOf = (
  plugin: VmSessionPlugin,
  url: string,
  context: LoadHookContext,
  rest: LoadHookSync,
  host: VmPluginHost,
): LoadFnOutput | undefined => plugin.load?.(url, context, rest, host)

const loadThroughPlugin = (
  plugin: VmSessionPlugin,
  url: string,
  context: LoadHookContext,
  rest: LoadHookSync,
  host: VmPluginHost,
  terminal: VmLoadTerminal,
): LoadFnOutput => loadHookOutputOf(plugin, url, context, rest, host) ?? rest(url, context, terminal)

const loadStepAt = (
  plugins: readonly VmSessionPlugin[],
  host: VmPluginHost,
  terminal: VmLoadTerminal,
  restOf: (index: number) => LoadHookSync,
  index: number,
  url: string,
  context: LoadHookContext,
): LoadFnOutput => {
  const plugin = plugins[index]
  return plugin === undefined
    ? terminal(url, context)
    : loadThroughPlugin(plugin, url, context, restOf(index + 1), host, terminal)
}

export const runLoadStage = dual<
  (
    host: VmPluginHost,
    url: string,
    context: LoadHookContext,
    terminal: VmLoadTerminal,
  ) => (plugins: readonly VmSessionPlugin[]) => LoadFnOutput,
  (
    plugins: readonly VmSessionPlugin[],
    host: VmPluginHost,
    url: string,
    context: LoadHookContext,
    terminal: VmLoadTerminal,
  ) => LoadFnOutput
>(5, (plugins, host, url, context, terminal): LoadFnOutput => {
  const restOf = (index: number): LoadHookSync => (nextUrl, nextContext) =>
    loadStepAt(plugins, host, terminal, restOf, index, nextUrl, nextContext)
  return restOf(0)(url, context, terminal)
})
