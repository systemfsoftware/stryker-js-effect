import type { VmProjectConfig, VmVitestConfig } from '../vitest-config.schema.js'
import { isAbsolute, join, resolve } from './node-builtins.js'

import { nativeImport } from '../native-import.handle.js'
import type { ArbitraryRecord, VitestProjectConfigView, VitestProjectView, VitestRootView } from './extract-config.js'
import { extractVitestConfig } from './extract-config.js'
import type { VmTransformResult } from './runtime.js'

const moduleBuiltin = globalThis.process.getBuiltinModule('node:module')
const urlBuiltin = globalThis.process.getBuiltinModule('node:url')

const { createRequire } = moduleBuiltin
const { pathToFileURL } = urlBuiltin

export interface VmVitestHostOptions {
  readonly sandboxWorkingDirectory: string
  readonly configFile: string | undefined
}

export interface VmVitestHost {
  readonly config: VmVitestConfig
  readonly hasTransformPlugins: boolean
  readonly transform: (code: string, id: string) => Promise<VmTransformResult | undefined>
  readonly transformRequest: (id: string) => Promise<VmTransformResult | undefined>
  readonly resolveId: (specifier: string, importer: string) => Promise<string | undefined>
  readonly resolveSnapshotPath: (testPath: string) => Promise<string>
  readonly listTestFiles: () => Promise<ReadonlyArray<string>>
  readonly listProjectFiles: () => Promise<
    ReadonlyArray<{ readonly name: string; readonly files: ReadonlyArray<string> }>
  >
  readonly close: () => Promise<void>
}

interface VitePluginView {
  readonly name?: string
  readonly transform?: object
}

interface VitePluginContainerView {
  readonly transform: (
    code: string,
    id: string,
    options?: { readonly ssr?: boolean },
  ) => Promise<{ readonly code: string } | null>
  readonly load: (id: string) => Promise<{ readonly code: string } | string | null>
  readonly resolveId: (
    rawId: string,
    importer?: string,
    options?: { readonly ssr?: boolean },
  ) => Promise<{ readonly id: string } | null>
}

type ViteEnvironmentConfig = {
  readonly resolve?: { readonly conditions?: ReadonlyArray<string> }
}

interface ViteEnvironmentView {
  readonly pluginContainer: VitePluginContainerView
  readonly transformRequest: (url: string) => Promise<{ readonly code: string } | null | undefined>
  readonly config?: ViteEnvironmentConfig
}

interface ViteServerView {
  readonly environments: Readonly<Record<string, ViteEnvironmentView>>
  readonly config?: { readonly plugins?: ReadonlyArray<VitePluginView> }
  readonly close: () => Promise<void>
}
interface VitestResolvedProjectView {
  readonly name: string
  readonly config: VitestProjectConfigView & {
    readonly viteConfig?: {
      readonly env?: ArbitraryRecord
      readonly plugins?: ReadonlyArray<VitePluginView>
    }
  }
  readonly vite: ViteServerView
  readonly serializedConfig: object
  readonly globTestFiles: () => Promise<{ readonly testFiles: ReadonlyArray<string> }>
  readonly isBrowserEnabled: () => boolean
  readonly matchesTestGlob: (moduleId: string, source?: () => string) => boolean
}

interface VitestInstanceView {
  readonly config: { readonly test?: { readonly provide?: ArbitraryRecord; readonly allowOnly?: boolean } }
  readonly projects: ReadonlyArray<VitestResolvedProjectView>
  readonly snapshot: { readonly resolvePath: (testPath: string, context?: object) => string }
  readonly close: () => Promise<void>
}
interface VitestNodeModuleView {
  readonly createVitest: (options: {
    readonly root: string
    readonly config: string | false
    readonly watch: false
    readonly coverage: { readonly enabled: false }
    readonly optimizeDeps: { readonly ignoreOutdatedRequests: boolean }
  }) => Promise<VitestInstanceView>
}

interface ResolvedIdView {
  readonly id?: string
}

interface RequestedTransformView {
  readonly code?: string
}

const BUILTIN_PLUGIN = /^(vite[:-]|vitest|rolldown[:-]|rollup[:-]|@vitejs\/|@rolldown\/|commonjs|oxc|esbuild)/

const cleanIdOf = (id: string): string => id.split('?')[0] ?? id

const absoluteSetupFile = (root: string, file: string): string => isAbsolute(file) ? file : resolve(root, file)

const setupFilesOf = (project: VitestResolvedProjectView): ReadonlyArray<string> => {
  const files = project.config.setupFiles ?? []
  return files.map((file) => absoluteSetupFile(project.config.root, file))
}

const viteEnvOf = (project: VitestResolvedProjectView): ArbitraryRecord | undefined => project.config.viteConfig?.env

const configOfEnvironment = (environment: ViteEnvironmentView | undefined): ViteEnvironmentConfig | undefined =>
  environment?.config

const resolveOfConfig = (config: ViteEnvironmentConfig | undefined): ViteEnvironmentConfig['resolve'] | undefined =>
  config?.resolve

const conditionsOfResolve = (
  resolveConfig: ViteEnvironmentConfig['resolve'] | undefined,
): ReadonlyArray<string> | undefined => resolveConfig?.conditions

const ssrEnvironmentOf = (project: VitestResolvedProjectView): ViteEnvironmentView | undefined =>
  project.vite.environments['ssr']

const serverConditionsOf = (project: VitestResolvedProjectView): ReadonlyArray<string> | undefined =>
  conditionsOfResolve(resolveOfConfig(configOfEnvironment(ssrEnvironmentOf(project))))

const projectViewOf = (project: VitestResolvedProjectView): VitestProjectView => ({
  name: project.name,
  browserEnabled: project.isBrowserEnabled(),
  config: {
    ...project.config,
    setupFiles: setupFilesOf(project),
  },
  viteEnv: viteEnvOf(project),
  serverConditions: serverConditionsOf(project),
})

const pluginNameOf = (plugin: VitePluginView): string => plugin.name ?? ''

const isCustomTransformPlugin = (plugin: VitePluginView): boolean =>
  plugin.transform !== undefined && !BUILTIN_PLUGIN.test(pluginNameOf(plugin))

const viteConfigPluginsOf = (project: VitestResolvedProjectView): ReadonlyArray<VitePluginView> | undefined =>
  project.vite.config?.plugins

const projectPluginsOf = (project: VitestResolvedProjectView): ReadonlyArray<VitePluginView> =>
  viteConfigPluginsOf(project) ?? []

const hasTransformPluginsOf = (project: VitestResolvedProjectView): boolean =>
  projectPluginsOf(project).some(isCustomTransformPlugin)

const environmentOf = (project: VitestResolvedProjectView): ViteEnvironmentView | undefined => {
  const environments = project.vite.environments
  return environments['ssr'] ?? Object.values(environments)[0]
}

const containerOf = (project: VitestResolvedProjectView): VitePluginContainerView | undefined =>
  environmentOf(project)?.pluginContainer

const NATIVE_LOADABLE = /[.](?:js|mjs|cjs|ts|mts|cts|json|node)$/

const isPlainEsm = (code: string): boolean => !code.includes('__vite_ssr_')

const isUsableId = (resolved: ResolvedIdView | null): resolved is ResolvedIdView & { readonly id: string } =>
  resolved !== null && typeof resolved.id === 'string'

const resolvedIdValueOf = (resolved: ResolvedIdView | null, cleanId: string): string =>
  isUsableId(resolved) ? resolved.id : cleanId

const resolvedIdPromiseOf = (
  container: VitePluginContainerView,
  cleanId: string,
  code: string | undefined,
): Promise<string> =>
  code === undefined
    ? container.resolveId(cleanId, undefined, { ssr: true }).then(
      (resolved) => resolvedIdValueOf(resolved, cleanId),
      () => cleanId,
    )
    : Promise.resolve(cleanId)

const isDefinedTransform = (
  requested: RequestedTransformView | null | undefined,
): requested is RequestedTransformView => requested !== null && requested !== undefined

const isCodedTransform = (
  requested: RequestedTransformView | null | undefined,
): requested is RequestedTransformView & { readonly code: string } =>
  isDefinedTransform(requested) && typeof requested.code === 'string'

const isPlainTransform = (requested: RequestedTransformView & { readonly code: string }): boolean =>
  isPlainEsm(requested.code)

const isUsableTransform = (
  requested: RequestedTransformView | null | undefined,
): requested is RequestedTransformView & { readonly code: string } =>
  isCodedTransform(requested) && isPlainTransform(requested)

const transformedCodeOf = (requested: RequestedTransformView | null | undefined): VmTransformResult | undefined =>
  isUsableTransform(requested) ? { code: requested.code } : undefined

const fallbackOf = (project: VitestResolvedProjectView, cleanId: string): Promise<VmTransformResult | undefined> => {
  const environment = environmentOf(project)
  if (environment === undefined) return Promise.resolve(undefined)
  return environment.transformRequest(cleanId).then((requested) => transformedCodeOf(requested))
}

const transformCodeOf = (
  result: RequestedTransformView | null,
  original: string,
): string => isCodedTransform(result) ? result.code : original

const transformWithFallbackOf = (
  project: VitestResolvedProjectView,
  container: VitePluginContainerView,
  cleanId: string,
  inputCode: string,
  resolvedId: string,
): Promise<VmTransformResult | undefined> =>
  container.transform(inputCode, resolvedId, { ssr: true }).then(
    (result): VmTransformResult => ({ code: transformCodeOf(result, inputCode) }),
    () => fallbackOf(project, cleanId),
  )

const isNativeLoadable = (project: VitestResolvedProjectView, cleanId: string): boolean =>
  !hasTransformPluginsOf(project) && NATIVE_LOADABLE.test(cleanId)

const untransformedOutcomeOf = (
  project: VitestResolvedProjectView,
  cleanId: string,
): Promise<VmTransformResult | undefined> =>
  isNativeLoadable(project, cleanId) ? Promise.resolve(undefined) : fallbackOf(project, cleanId)

const nullLoadedOutcomeOf = (
  project: VitestResolvedProjectView,
  container: VitePluginContainerView,
  cleanId: string,
  code: string | undefined,
  resolvedId: string,
): Promise<VmTransformResult | undefined> =>
  code === undefined
    ? untransformedOutcomeOf(project, cleanId)
    : transformWithFallbackOf(project, container, cleanId, code, resolvedId)

const loadedCodeOf = (loaded: { readonly code: string } | string): string =>
  typeof loaded === 'string' ? loaded : loaded.code

const loadedOutcomeOf = (
  project: VitestResolvedProjectView,
  container: VitePluginContainerView,
  cleanId: string,
  code: string | undefined,
  resolvedId: string,
  loaded: { readonly code: string } | string | null,
): Promise<VmTransformResult | undefined> => {
  if (loaded === null) return nullLoadedOutcomeOf(project, container, cleanId, code, resolvedId)
  return transformWithFallbackOf(project, container, cleanId, loadedCodeOf(loaded), resolvedId)
}

const loadAndTransform = (
  project: VitestResolvedProjectView,
  id: string,
  code: string | undefined,
): Promise<VmTransformResult | undefined> => {
  const cleanId = cleanIdOf(id)
  const container = containerOf(project)
  if (container === undefined) return Promise.resolve(undefined)
  return resolvedIdPromiseOf(container, cleanId, code).then((resolvedId) =>
    container.load(resolvedId).then((loaded) => loadedOutcomeOf(project, container, cleanId, code, resolvedId, loaded))
  )
}

const globProjectOf = (
  projects: ReadonlyArray<VitestResolvedProjectView>,
  cleanId: string,
): VitestResolvedProjectView | undefined => projects.find((project) => project.matchesTestGlob(cleanId))

const rootProjectOf = (
  projects: ReadonlyArray<VitestResolvedProjectView>,
  cleanId: string,
): VitestResolvedProjectView | undefined => projects.find((project) => cleanId.startsWith(project.config.root))

const rootedProjectOf = (
  projects: ReadonlyArray<VitestResolvedProjectView>,
  cleanId: string,
): VitestResolvedProjectView | undefined => rootProjectOf(projects, cleanId) ?? projects[0]

const matchedProjectOf = (
  projects: ReadonlyArray<VitestResolvedProjectView>,
  cleanId: string,
): VitestResolvedProjectView | undefined => globProjectOf(projects, cleanId) ?? rootedProjectOf(projects, cleanId)

const requireProject = (matched: VitestResolvedProjectView | undefined, file: string): VitestResolvedProjectView => {
  if (matched === undefined) throw new Error(`Vitest transform host has no project for '${file}'`)
  return matched
}

const projectForFileOf = (
  vitest: VitestInstanceView,
  cache: Map<string, VitestResolvedProjectView>,
  file: string,
): VitestResolvedProjectView => {
  const cached = cache.get(file)
  if (cached !== undefined) return cached
  const matched = requireProject(matchedProjectOf(vitest.projects, cleanIdOf(file)), file)
  cache.set(file, matched)
  return matched
}

const projectForFileIn = (vitest: VitestInstanceView): (file: string) => VitestResolvedProjectView => {
  const cache = new Map<string, VitestResolvedProjectView>()
  return (file) => projectForFileOf(vitest, cache, file)
}

const resolvedIdOrUndefined = (resolved: ResolvedIdView | null): string | undefined =>
  isUsableId(resolved) ? resolved.id : undefined

const resolvedIdForContainer = (
  container: VitePluginContainerView,
  specifier: string,
  importer: string,
): Promise<string | undefined> =>
  container.resolveId(specifier, importer, { ssr: true }).then((resolved) => resolvedIdOrUndefined(resolved))

const resolveIdWith = (
  projectForFile: (file: string) => VitestResolvedProjectView,
  specifier: string,
  importer: string,
): Promise<string | undefined> => {
  const container = containerOf(projectForFile(importer))
  if (container === undefined) return Promise.resolve(undefined)
  return resolvedIdForContainer(container, specifier, importer)
}

const listInOrder = <A>(
  projects: ReadonlyArray<VitestResolvedProjectView>,
  collect: (project: VitestResolvedProjectView) => Promise<A>,
): Promise<ReadonlyArray<A>> => {
  const collected: A[] = []
  let pending: Promise<void> = Promise.resolve()
  for (const project of projects) {
    pending = pending
      .then(() => collect(project))
      .then((part): void => {
        collected.push(part)
      })
  }
  return pending.then((): ReadonlyArray<A> => collected)
}

const listTestFilesOf = (vitest: VitestInstanceView): Promise<ReadonlyArray<string>> =>
  listInOrder(vitest.projects, (project) => project.globTestFiles()).then((globbed) =>
    globbed.flatMap((part) => part.testFiles)
  )

const listProjectFilesOf = (
  vitest: VitestInstanceView,
): Promise<ReadonlyArray<{ readonly name: string; readonly files: ReadonlyArray<string> }>> =>
  listInOrder(
    vitest.projects,
    (project) => project.globTestFiles().then((globbed) => ({ name: project.name, files: globbed.testFiles })),
  )

const vitestHostOf = (
  config: VmVitestConfig,
  hasTransformPlugins: boolean,
  projectForFile: (file: string) => VitestResolvedProjectView,
  vitest: VitestInstanceView,
): VmVitestHost => ({
  config,
  hasTransformPlugins,
  transform: (code: string, id: string): Promise<VmTransformResult | undefined> => {
    const cleanId = cleanIdOf(id)
    return loadAndTransform(projectForFile(cleanId), cleanId, code)
  },
  transformRequest: (id: string): Promise<VmTransformResult | undefined> => {
    const cleanId = cleanIdOf(id)
    return loadAndTransform(projectForFile(cleanId), cleanId, undefined)
  },
  resolveId: (specifier: string, importer: string): Promise<string | undefined> =>
    resolveIdWith(projectForFile, specifier, importer),
  resolveSnapshotPath: (testPath: string): Promise<string> => {
    const project = projectForFile(testPath)
    return Promise.resolve(vitest.snapshot.resolvePath(testPath, { config: project.serializedConfig }))
  },
  listTestFiles: (): Promise<ReadonlyArray<string>> => listTestFilesOf(vitest),
  listProjectFiles: (): Promise<ReadonlyArray<{ readonly name: string; readonly files: ReadonlyArray<string> }>> =>
    listProjectFilesOf(vitest),
  close: () => vitest.close(),
})

const optionalConfigFile = (configFile: string | undefined): { readonly configFile?: string } =>
  configFile === undefined ? {} : { configFile }

const testConfigOf = (
  vitest: VitestInstanceView,
): { readonly provide?: ArbitraryRecord; readonly allowOnly?: boolean } | undefined => vitest.config.test

const rootProvideOf = (vitest: VitestInstanceView): ArbitraryRecord | undefined => testConfigOf(vitest)?.provide

const isStringValue = (value: string | undefined): value is string => typeof value === 'string'

const stringEnvEntries = (env: Record<string, string | undefined>): ReadonlyArray<[string, string]> =>
  Object.entries(env).flatMap(([name, value]): Array<[string, string]> => isStringValue(value) ? [[name, value]] : [])

const envSeedsOf = (envKeysBefore: Set<string>, env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(stringEnvEntries(env).filter(([name]) => !envKeysBefore.has(name)))

const rootViewOf = (
  options: VmVitestHostOptions,
  vitest: VitestInstanceView,
  envSeeds: Record<string, string>,
): VitestRootView => ({
  ...optionalConfigFile(options.configFile),
  provide: rootProvideOf(vitest),
  envSeeds,
  projects: vitest.projects.map(projectViewOf),
})

const vitestOptionsOf = (options: VmVitestHostOptions): Parameters<VitestNodeModuleView['createVitest']>[0] => ({
  root: options.sandboxWorkingDirectory,
  config: options.configFile ?? false,
  watch: false,
  coverage: { enabled: false },
  optimizeDeps: { ignoreOutdatedRequests: true },
})

const vitestHostOfFor = (
  options: VmVitestHostOptions,
  vitest: VitestInstanceView,
  envKeysBefore: Set<string>,
): VmVitestHost => {
  const envSeeds = envSeedsOf(envKeysBefore, globalThis.process.env)
  const config = extractVitestConfig(rootViewOf(options, vitest, envSeeds))
  const hasTransformPlugins = vitest.projects.some(hasTransformPluginsOf)
  return vitestHostOf(config, hasTransformPlugins, projectForFileIn(vitest), vitest)
}

export const createVitestHost = (options: VmVitestHostOptions): Promise<VmVitestHost> => {
  const sandboxRequire = createRequire(join(options.sandboxWorkingDirectory, 'package.json'))
  const vitestNodePath = sandboxRequire.resolve('vitest/node')
  const envKeysBefore = new Set(Object.keys(globalThis.process.env))
  return nativeImport<VitestNodeModuleView>(pathToFileURL(vitestNodePath).href).then((vitestModule) =>
    vitestModule
      .createVitest(vitestOptionsOf(options))
      .then((vitest) => vitestHostOfFor(options, vitest, envKeysBefore))
  )
}

export type { VmProjectConfig }
