import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'

import { createDefaultOptions } from '@systemfsoftware/stryker-js-engine'
import type { PluginShadowing } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import {
  loadPlugins,
  PluginExtensionClaimShadowing,
  PluginLoadFailedError,
} from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import { Module } from '@systemfsoftware/stryker-js-language'
import { RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

interface NodeModuleShape {
  createRequire(filename: string | URL): NodeRequire
  isBuiltin(moduleName: string): boolean
}

const EMPTY_PATHS: readonly string[] = []

const makeModuleRequire = (
  nodeModule: NodeModuleShape,
  filename: string | URL,
  modules: Readonly<Record<string, unknown>> = {},
): ModuleRequire => {
  const requireFrom: NodeRequire = nodeModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => modules[request] ?? requireFrom(request)
  requireFn.resolve = (request, options) =>
    Option.match(Option.fromUndefinedOr(options), {
      onNone: () => requireFrom.resolve(request),
      onSome: (present) =>
        requireFrom.resolve(request, {
          paths: [...Option.getOrElse(Option.fromNullishOr(present.paths), () => EMPTY_PATHS)],
        }),
    })
  return requireFn
}

const moduleLayer = Layer.effect(
  Module,
  Effect.sync(() => {
    const nodeModule: NodeModuleShape = process.getBuiltinModule('node:module')
    return {
      createRequire: (filename: string | URL) => makeModuleRequire(nodeModule, filename),
      isBuiltin: (moduleName: string) => nodeModule.isBuiltin(moduleName),
    }
  }),
)

export const pluginEnvironmentLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  moduleLayer,
  Layer.succeed(RunConfiguration, Effect.runSync(createDefaultOptions())),
  Layer.succeed(SandboxDirectory, '/tmp'),
)

const PLUGIN_SCOPE = '@systemfsoftware'

const EMPTY_DIRECTORY_ENTRIES: readonly string[] = []

const pathService: Path.Path = Effect.runSync(
  Effect.gen(function*() {
    return yield* Path.Path
  }).pipe(Effect.provide(Path.layer)),
)

const WORKSPACE_ROOT = pathService.resolve(
  Effect.runSync(pathService.fromFileUrl(new URL('../../../../', import.meta.url))),
)

const ENGINE_ROOT = pathService.resolve(
  Effect.runSync(pathService.fromFileUrl(new URL('../../', import.meta.url))),
)

interface InstalledWorkspacePackage {
  readonly moduleName: string
  readonly packageDirectory: string
  readonly preloadBuiltEntry: boolean
}

const FRAMEWORK_PLUGIN_PACKAGES: readonly InstalledWorkspacePackage[] = [
  {
    moduleName: `${PLUGIN_SCOPE}/stryker-js-angular`,
    packageDirectory: 'packages/frameworks/angular',
    preloadBuiltEntry: true,
  },
  {
    moduleName: `${PLUGIN_SCOPE}/stryker-js-svelte`,
    packageDirectory: 'packages/frameworks/svelte',
    preloadBuiltEntry: true,
  },
]

const NON_PLUGIN_FAMILY_PACKAGE: InstalledWorkspacePackage = {
  moduleName: `${PLUGIN_SCOPE}/stryker-js-cli`,
  packageDirectory: 'apps/stryker-js-cli',
  preloadBuiltEntry: false,
}

const INSTALLED_WORKSPACE_PACKAGES: readonly InstalledWorkspacePackage[] = [
  ...FRAMEWORK_PLUGIN_PACKAGES,
  NON_PLUGIN_FAMILY_PACKAGE,
]

const PRELOADED_PLUGIN_PACKAGES: readonly InstalledWorkspacePackage[] = INSTALLED_WORKSPACE_PACKAGES.filter(
  (pkg) => pkg.preloadBuiltEntry,
)

const BUILT_ENTRY = ['dist', 'index.mjs']

const pluginBuiltEntryOf = (pkg: InstalledWorkspacePackage): string =>
  pathService.join(WORKSPACE_ROOT, pkg.packageDirectory, ...BUILT_ENTRY)

const loadedPluginModules: Effect.Effect<Readonly<Record<string, unknown>>> = Effect.forEach(
  PRELOADED_PLUGIN_PACKAGES,
  (pkg) => Effect.promise(() => import(pluginBuiltEntryOf(pkg))),
  { concurrency: 'unbounded' },
).pipe(
  Effect.map((modules) =>
    Object.fromEntries(
      PRELOADED_PLUGIN_PACKAGES.map((pkg, index) => [pkg.moduleName, modules[index]]),
    )
  ),
)

export interface PluginInstall {
  readonly directory: string
  readonly scopeEntries: readonly string[]
}

export const installWorkspaceFrameworkPlugins: Effect.Effect<PluginInstall> = Effect.gen(function*() {
  const directory = yield* Effect.sync(() => mkdtempSync(pathService.join(ENGINE_ROOT, 'temp', 'preset-plugins-')))
  const scopeDirectory = pathService.join(directory, 'node_modules', PLUGIN_SCOPE)
  yield* Effect.sync(() => {
    mkdirSync(scopeDirectory, { recursive: true })
    for (const pkg of INSTALLED_WORKSPACE_PACKAGES) {
      symlinkSync(
        pathService.join(WORKSPACE_ROOT, pkg.packageDirectory),
        pathService.join(scopeDirectory, pathService.basename(pkg.moduleName)),
        'dir',
      )
    }
  })
  return { directory, scopeEntries: yield* Effect.sync(() => readdirSync(scopeDirectory)) }
})

export const removePluginInstall = (install: PluginInstall): void => {
  rmSync(install.directory, { recursive: true, force: true })
}

export const pluginInstallEnvironmentLayer = (
  install: PluginInstall,
): Layer.Layer<FileSystem.FileSystem | Path.Path | Module | RunConfiguration | SandboxDirectory> =>
  Layer.mergeAll(
    FileSystem.layerNoop({
      readDirectory: (directory: string) =>
        Match.value(pathService.basename(pathService.resolve(directory))).pipe(
          Match.when(PLUGIN_SCOPE, () => Effect.succeed([...install.scopeEntries])),
          Match.orElse(() => Effect.succeed([...EMPTY_DIRECTORY_ENTRIES])),
        ),
    }),
    Path.layer,
    Layer.effect(
      Module,
      Effect.gen(function*() {
        const nodeModule: NodeModuleShape = process.getBuiltinModule('node:module')
        const pluginModules = yield* loadedPluginModules
        return {
          createRequire: (filename: string | URL): ModuleRequire =>
            makeModuleRequire(nodeModule, filename, pluginModules),
          isBuiltin: (moduleName: string) => nodeModule.isBuiltin(moduleName),
        }
      }),
    ),
    Layer.succeed(RunConfiguration, Effect.runSync(createDefaultOptions())),
    Layer.succeed(SandboxDirectory, install.directory),
  )

export const fixturePath = (name: string): string => `${process.cwd()}/tests/__fixtures__/${name}`

export const loadDescriptors = (descriptors: readonly string[]) =>
  loadPlugins(descriptors, process.cwd()).pipe(
    Effect.provide(Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, moduleLayer)),
  )

export const loadFixture = (name: string) => loadDescriptors([fixturePath(name)])

export const isExtensionClaimShadowing = (shadowing: PluginShadowing): shadowing is PluginExtensionClaimShadowing =>
  shadowing instanceof PluginExtensionClaimShadowing

export const reasonTagOf = (reason: PluginLoadFailedError['reason']): string =>
  Match.value(reason).pipe(
    Match.tag('PeerMissing', () => 'PeerMissing'),
    Match.tag('PeerVersionUnsupported', () => 'PeerVersionUnsupported'),
    Match.tag('InvalidContribution', () => 'InvalidContribution'),
    Match.tag('ImportFailed', () => 'ImportFailed'),
    Match.exhaustive,
  )

export const refusalFieldsOf = (reason: PluginLoadFailedError['reason']) =>
  Match.value(reason).pipe(
    Match.tag('PeerMissing', (missing) => ({ peer: missing.peer, version: undefined, supportedRange: undefined })),
    Match.tag('PeerVersionUnsupported', (unsupported) => ({
      peer: unsupported.peer,
      version: unsupported.version,
      supportedRange: unsupported.supportedRange,
    })),
    Match.orElse(() => ({ peer: undefined, version: undefined, supportedRange: undefined })),
  )

export const REFUSAL_ROWS = [
  {
    label: 'unusable parsing',
    fixture: 'framework-malformed.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: '',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'an import that fails',
    fixture: 'framework-throwing.fixture.mjs',
    reason: 'ImportFailed',
    exitClass: 'InternalError',
    detail: '',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'an unsupported format-contract version',
    fixture: 'framework-version-unsupported.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: '"2"',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a peer that is not installed',
    fixture: 'framework-peer-missing.fixture.mjs',
    reason: 'PeerMissing',
    exitClass: 'ConfigError',
    detail: '',
    peer: 'svelte',
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a peer version outside the supported range',
    fixture: 'framework-peer-version-unsupported.fixture.mjs',
    reason: 'PeerVersionUnsupported',
    exitClass: 'ConfigError',
    detail: '',
    peer: 'svelte',
    version: '3.20.0',
    supportedRange: '>=3.30',
  },
  {
    label: 'a layer build that dies',
    fixture: 'framework-build-dies.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: 'failed to build',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
  {
    label: 'a refusal that names no peer',
    fixture: 'framework-refused.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: 'the "angular-html-parser/package.json" hard dependency is not resolvable',
    peer: undefined,
    version: undefined,
    supportedRange: undefined,
  },
] as const
