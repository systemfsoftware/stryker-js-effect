import { createRequire } from 'node:module'

import { pathToFileURL } from 'node:url'
import { isAbsolute, join, resolve } from './node-builtins.js'

import type { VmProjectConfig, VmVitestConfig } from '../../core/vitest-config.schema.js'
import { nativeImport } from '../native-import.js'
import { replaceCodeToken } from './code-rewrite.js'
import type { ArbitraryRecord, VitestProjectConfigView, VitestProjectView } from './extract-config.js'
import { extractVitestConfig } from './extract-config.js'
import type { VmTransformResult } from './runtime.js'

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

interface ViteEnvironmentView {
  readonly pluginContainer: VitePluginContainerView
  readonly transformRequest: (url: string) => Promise<{ readonly code: string } | null | undefined>
  readonly config?: { readonly resolve?: { readonly conditions?: ReadonlyArray<string> } }
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

const BUILTIN_PLUGIN = /^(vite[:-]|vitest|rolldown[:-]|rollup[:-]|@vitejs\/|@rolldown\/|commonjs|oxc|esbuild)/

const projectViewOf = (project: VitestResolvedProjectView): VitestProjectView => ({
  name: project.name,
  browserEnabled: project.isBrowserEnabled(),
  config: {
    ...project.config,
    setupFiles: (project.config.setupFiles ?? []).map((file) =>
      isAbsolute(file) ? file : resolve(project.config.root, file)
    ),
  },
  viteEnv: project.config.viteConfig?.env,
  serverConditions: project.vite.environments['ssr']?.config?.resolve?.conditions,
})

const hasTransformPluginsOf = (project: VitestResolvedProjectView): boolean =>
  (project.vite.config?.plugins ?? []).some((plugin) => {
    const name = plugin.name ?? ''
    return plugin.transform !== undefined && !BUILTIN_PLUGIN.test(name)
  })

const environmentOf = (project: VitestResolvedProjectView): ViteEnvironmentView | undefined => {
  const environments = project.vite.environments
  return environments['ssr'] ?? Object.values(environments)[0]
}

const containerOf = (project: VitestResolvedProjectView): VitePluginContainerView | undefined =>
  environmentOf(project)?.pluginContainer

const NATIVE_LOADABLE = /[.](?:js|mjs|cjs|ts|mts|cts|json|node)$/

const stringDefinesOf = (candidate: ArbitraryRecord | undefined): Readonly<Record<string, string>> => {
  if (candidate === undefined) return {}
  const out: Record<string, string> = {}
  for (const key of Object.keys(candidate)) {
    if (!Object.hasOwn(candidate, key)) continue
    const value = candidate[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

const defineOf = (project: VitestResolvedProjectView): Readonly<Record<string, string>> => ({
  ...stringDefinesOf(project.config.define),
  ...stringDefinesOf(project.config.defines),
})

const withDefine = (project: VitestResolvedProjectView, code: string): string => {
  const entries = Object.entries(defineOf(project)).filter(([key]) => !key.startsWith('import.meta.'))
  if (entries.length === 0) return code
  let rewritten = code
  for (const [key, value] of entries) {
    rewritten = replaceCodeToken(rewritten, key, value).code
  }
  return rewritten
}

const isPlainEsm = (code: string): boolean => !code.includes('__vite_ssr_')
const loadAndTransform = (
  project: VitestResolvedProjectView,
  id: string,
  code: string | undefined,
): Promise<VmTransformResult | undefined> => {
  const cleanId = id.split('?')[0] ?? id
  const container = containerOf(project)
  if (container === undefined) return Promise.resolve(undefined)
  const resolvedIdOf = code === undefined
    ? container.resolveId(cleanId, undefined, { ssr: true }).then(
      (resolved) => (resolved === null || typeof resolved.id !== 'string' ? cleanId : resolved.id),
      () => cleanId,
    )
    : Promise.resolve(cleanId)
  const fallbackOf = (): Promise<VmTransformResult | undefined> => {
    const environment = environmentOf(project)
    if (environment === undefined) return Promise.resolve(undefined)
    return environment.transformRequest(cleanId).then((requested) =>
      requested === null || requested === undefined || typeof requested.code !== 'string' ||
        !isPlainEsm(requested.code)
        ? undefined
        : { code: withDefine(project, requested.code) }
    )
  }
  return resolvedIdOf.then((resolvedId) =>
    container.load(resolvedId).then((loaded) => {
      if (loaded === null) {
        if (code === undefined) {
          if (!hasTransformPluginsOf(project) && NATIVE_LOADABLE.test(cleanId)) return undefined
          return fallbackOf()
        }
        return container.transform(code, resolvedId, { ssr: true }).then(
          (result) =>
            result === null || typeof result.code !== 'string'
              ? { code: withDefine(project, code) }
              : { code: withDefine(project, result.code) },
          () => fallbackOf(),
        )
      }
      const loadedCode = typeof loaded === 'string' ? loaded : loaded.code
      return container.transform(loadedCode, resolvedId, { ssr: true }).then(
        (result) =>
          result === null || typeof result.code !== 'string'
            ? { code: withDefine(project, loadedCode) }
            : { code: withDefine(project, result.code) },
        () => fallbackOf(),
      )
    })
  )
}
export const createVitestHost = (options: VmVitestHostOptions): Promise<VmVitestHost> => {
  const sandboxRequire = createRequire(join(options.sandboxWorkingDirectory, 'package.json'))
  const vitestNodePath = sandboxRequire.resolve('vitest/node')
  const envKeysBefore = new Set(Object.keys(process.env))
  return nativeImport<VitestNodeModuleView>(pathToFileURL(vitestNodePath).href).then((vitestModule) =>
    vitestModule
      .createVitest({
        root: options.sandboxWorkingDirectory,
        config: options.configFile ?? false,
        watch: false,
        coverage: { enabled: false },
        optimizeDeps: { ignoreOutdatedRequests: true },
      })
      .then((vitest): VmVitestHost => {
        const envSeeds: Record<string, string> = {}
        const hostEnv = Reflect.get(globalThis.process, 'env') as ArbitraryRecord | undefined
        for (const [name, value] of Object.entries(hostEnv ?? {})) {
          if (envKeysBefore.has(name) || typeof value !== 'string') continue
          envSeeds[name] = value
        }
        const rootProvide = vitest.config.test?.provide
        const config: VmVitestConfig = extractVitestConfig({
          ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
          provide: rootProvide,
          envSeeds,
          projects: vitest.projects.map(projectViewOf),
        })
        const hasTransformPlugins = vitest.projects.some(hasTransformPluginsOf)
        const projectForFileCache = new Map<string, VitestResolvedProjectView>()
        const projectForFile = (file: string): VitestResolvedProjectView => {
          const cached = projectForFileCache.get(file)
          if (cached !== undefined) return cached
          const cleanId = file.split('?')[0] ?? file
          const matched = vitest.projects.find((project) => project.matchesTestGlob(cleanId)) ??
            vitest.projects.find((project) => cleanId.startsWith(project.config.root)) ??
            vitest.projects[0]
          if (matched === undefined) throw new Error(`Vitest transform host has no project for '${file}'`)
          projectForFileCache.set(file, matched)
          return matched
        }

        const listInOrder = <A>(
          collect: (project: VitestResolvedProjectView) => Promise<A>,
        ): Promise<ReadonlyArray<A>> => {
          const collected: A[] = []
          let pending: Promise<void> = Promise.resolve()
          for (const project of vitest.projects) {
            pending = pending
              .then(() => collect(project))
              .then((part): void => {
                collected.push(part)
              })
          }
          return pending.then((): ReadonlyArray<A> => collected)
        }
        return {
          config,
          hasTransformPlugins,
          transform: (code: string, id: string): Promise<VmTransformResult | undefined> => {
            const cleanId = id.split('?')[0] ?? id
            return loadAndTransform(projectForFile(cleanId), cleanId, code)
          },
          transformRequest: (id: string): Promise<VmTransformResult | undefined> => {
            const cleanId = id.split('?')[0] ?? id
            return loadAndTransform(projectForFile(cleanId), cleanId, undefined)
          },
          resolveId: (specifier: string, importer: string): Promise<string | undefined> => {
            const container = containerOf(projectForFile(importer))
            if (container === undefined) return Promise.resolve(undefined)
            return container.resolveId(specifier, importer, { ssr: true }).then((resolved) =>
              resolved === null || typeof resolved.id !== 'string' ? undefined : resolved.id
            )
          },
          resolveSnapshotPath: (testPath: string): Promise<string> => {
            const project = projectForFile(testPath)
            return Promise.resolve(vitest.snapshot.resolvePath(testPath, { config: project.serializedConfig }))
          },
          listTestFiles: (): Promise<ReadonlyArray<string>> =>
            listInOrder((project) => project.globTestFiles()).then((globbed) =>
              globbed.flatMap((part) => part.testFiles)
            ),
          listProjectFiles: (): Promise<
            ReadonlyArray<{ readonly name: string; readonly files: ReadonlyArray<string> }>
          > =>
            listInOrder((project) =>
              project.globTestFiles().then((globbed) => ({ name: project.name, files: globbed.testFiles }))
            ),
          close: () => vitest.close(),
        }
      })
  )
}

export type { VmProjectConfig }
