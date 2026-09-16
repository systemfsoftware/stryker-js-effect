import { Framework, FrameworkFailed, Module } from '@systemfsoftware/stryker-js-language'
import type { FrameworkService, ModuleRequire, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import type { PluginEnvironment } from '@systemfsoftware/stryker-js-plugin-interface'
import { RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins } from '@systemfsoftware/stryker-js-svelte'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { fileURLToPath } from 'node:url'

import manifest from '../../package.json' with { type: 'json' }

export const sveltePeerRange: string = manifest.peerDependencies.svelte
export const svelteDevPin: string = manifest.devDependencies.svelte

export const peerFloor = (range: string): readonly [number, number] => {
  const parts = range.replace('>=', '').split('.')
  return [Number(parts.at(0)), Number(parts.at(1))]
}

export interface SvelteServiceOutcome {
  readonly service: FrameworkService | undefined
  readonly failure: FrameworkFailed | undefined
}

const EMPTY_PATHS: readonly string[] = []

const options: StrykerOptions = Effect.runSync(S.decodeEffect(StrykerOptionsSchema)({}).pipe(Effect.orDie))

interface NodeModuleShape {
  createRequire(filename: string | URL): {
    (request: string): unknown
    resolve(request: string, options?: { paths?: string[] }): string
  }
  isBuiltin(moduleName: string): boolean
}

const hostModule: NodeModuleShape = process.getBuiltinModule('node:module')

const makeModuleRequire = (filename: string | URL): ModuleRequire => {
  const requireFrom = hostModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => requireFrom(request)
  requireFn.resolve = (request, resolveOptions) =>
    Option.match(Option.fromUndefinedOr(resolveOptions), {
      onNone: () => requireFrom.resolve(request),
      onSome: (present) =>
        requireFrom.resolve(request, {
          paths: [...Option.getOrElse(Option.fromNullishOr(present.paths), () => EMPTY_PATHS)],
        }),
    })
  return requireFn
}

const peerRequire = (peers: Readonly<Record<string, string>>): ModuleRequire => {
  const resolve = (specifier: string): string =>
    Option.getOrThrowWith(
      Option.fromNullishOr(peers[specifier]),
      () => new Error(`Cannot find module '${specifier}'`),
    )
  return Object.assign((request: string): unknown => resolve(request), { resolve })
}

const nodeModuleLayer: Layer.Layer<Module> = Layer.effect(
  Module,
  Effect.sync(() => ({
    createRequire: (filename: string | URL): ModuleRequire => makeModuleRequire(filename),
    isBuiltin: (moduleName: string): boolean => hostModule.isBuiltin(moduleName),
  })),
)

const stubbedModuleLayer = (peers: Readonly<Record<string, string>>): Layer.Layer<Module> =>
  Layer.effect(
    Module,
    Effect.sync(() => ({
      createRequire: (): ModuleRequire => peerRequire(peers),
      isBuiltin: (): boolean => false,
    })),
  )

const environmentOf = (
  moduleLayer: Layer.Layer<Module>,
  sandboxDirectory: string,
): Layer.Layer<PluginEnvironment> =>
  Layer.mergeAll(
    moduleLayer,
    Layer.succeed(SandboxDirectory, sandboxDirectory),
    Layer.succeed(RunConfiguration, options),
    FileSystem.layerNoop({}),
    Path.layer,
  )

const environmentLayer = (sandboxDirectory: string): Layer.Layer<PluginEnvironment> =>
  environmentOf(nodeModuleLayer, sandboxDirectory)

export const peerEnvironmentLayer = (
  sandboxDirectory: string,
  peers: Readonly<Record<string, string>>,
): Layer.Layer<PluginEnvironment> => environmentOf(stubbedModuleLayer(peers), sandboxDirectory)

const sveltePluginLayer = Option.getOrThrowWith(
  Option.map(Option.fromNullishOr(strykerPlugins.at(0)), (plugin) => plugin.layer),
  () => new Error('@systemfsoftware/stryker-js-svelte publishes no Framework contribution'),
)

export const svelteService = (environment: Layer.Layer<PluginEnvironment>) =>
  Effect.scoped(Layer.build(sveltePluginLayer.pipe(Layer.provide(environment)))).pipe(
    Effect.map((context) => Context.get(context, Framework)),
  )

const failureOf = (cause: Cause.Cause<FrameworkFailed>): FrameworkFailed | undefined =>
  Option.getOrUndefined(Cause.findErrorOption(cause))

const outcomeOf = (exit: Exit.Exit<FrameworkService, FrameworkFailed>): SvelteServiceOutcome =>
  Match.value(exit).pipe(
    Match.when(Exit.isSuccess, (success) => ({ service: success.value, failure: undefined })),
    Match.orElse((failure) => ({ service: undefined, failure: failureOf(failure.cause) })),
  )

export const serviceOutcome = (environment: Layer.Layer<PluginEnvironment>) =>
  Effect.map(Effect.exit(svelteService(environment)), outcomeOf)

const pluginDirectory: Effect.Effect<string, never, Path.Path> = Effect.gen(function*() {
  const pathService = yield* Path.Path
  return yield* pathService.fromFileUrl(new URL('../../', import.meta.url)).pipe(Effect.orDie)
})

export const installedEnvironmentLayer: Effect.Effect<Layer.Layer<PluginEnvironment>> = Effect.map(
  pluginDirectory,
  (directory) => environmentLayer(directory),
).pipe(Effect.provide(Path.layer))

const peerPath = (name: string): string => fileURLToPath(new URL(`./${name}`, import.meta.url))

export const fixturePeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-floor.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker.mjs'),
})

export const strangerPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-stranger.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker.mjs'),
})

export const walkerlessPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-walkerless.mjs'),
  'oxc-walker': peerPath('peer-oxc-walkerless.mjs'),
})

export const belowRangePeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-below.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker.mjs'),
})

export const missingPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-absent.mjs'),
})

export const interopPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-compiler-interop.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker-interop.mjs'),
})

export const shapelessPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-shapeless.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker.mjs'),
})

export const interopShapelessPeers = (): Readonly<Record<string, string>> => ({
  'svelte/compiler': peerPath('peer-svelte-interop-shapeless.mjs'),
  'oxc-walker': peerPath('peer-oxc-walker.mjs'),
})
