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

const makeModuleRequire = (nodeModule: NodeModuleShape, filename: string | URL): ModuleRequire => {
  const requireFrom: NodeRequire = nodeModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => requireFrom(request)
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

export const REFUSAL_ROWS = [
  {
    label: 'unusable parsing',
    fixture: 'framework-malformed.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: '',
  },
  {
    label: 'an import that fails',
    fixture: 'framework-throwing.fixture.mjs',
    reason: 'ImportFailed',
    exitClass: 'InternalError',
    detail: '',
  },
  {
    label: 'an unsupported format-contract version',
    fixture: 'framework-version-unsupported.fixture.mjs',
    reason: 'InvalidContribution',
    exitClass: 'ConfigError',
    detail: '"2"',
  },
] as const
