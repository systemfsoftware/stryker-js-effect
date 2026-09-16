import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import type { Ignorer as IgnorerDescriptor } from '@systemfsoftware/stryker-ignorer-interface'
import { Module } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import type { WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import { importModule } from './Config.js'
import type { PluginLoadDecision, PluginSelectionError } from './plan-plugin-load.workflow.js'
import {
  planPluginLoad,
  PluginLoadCommand,
  ResolvedSpecifier,
  UnresolvedSpecifier,
} from './plan-plugin-load.workflow.js'

import {
  IgnorerModuleSchema,
  PluginLoadFailedError,
  PluginModuleSchema,
  PluginNotFoundError,
  SchemaValidationContributionSchema,
} from './Plugins.schema.js'

export type PluginKind = WorkerPluginKind | 'Evaluator'

export interface PluginDescriptor<K extends PluginKind = PluginKind> {
  readonly kind: K
  readonly name: string
}

export type AnyPluginDescriptor = { [K in PluginKind]: PluginDescriptor<K> }[PluginKind]

export type PluginDescriptorOf<K extends PluginKind> = Extract<AnyPluginDescriptor, { readonly kind: K }>

export interface PluginSource {
  readonly kind: PluginKind
  readonly name: string
  readonly modulePath: string
}

const NO_IGNORERS: readonly IgnorerDescriptor[] = []

export interface PluginLoaderEntryLike {
  readonly moduleName: string
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly schemaContribution: Record<string, unknown> | undefined
}

export interface PluginLoadPlan {
  readonly schemaContributions: readonly Record<string, unknown>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly shadowings: readonly {
    readonly kind: PluginKind
    readonly name: string
    readonly shadowedIndex: number
    readonly winnerIndex: number
  }[]
}

export const buildPluginLoadPlan = (entries: readonly PluginLoaderEntryLike[]): PluginLoadPlan => {
  const shadowingState = entries.reduce<{
    readonly seen: HashMap.HashMap<string, number>
    readonly shadowings: readonly {
      readonly kind: PluginKind
      readonly name: string
      readonly shadowedIndex: number
      readonly winnerIndex: number
    }[]
  }>(
    (acc, entry, index) =>
      Option.match(Option.fromUndefinedOr(entry.plugins), {
        onNone: () => acc,
        onSome: (plugins) =>
          plugins.reduce(
            (inner, plugin) => {
              const key = `${plugin.kind}:${plugin.name}`
              const previousOption = HashMap.get(inner.seen, key)
              const nextShadowings = Option.match(previousOption, {
                onNone: () => inner.shadowings,
                onSome: (prev) => [
                  ...inner.shadowings,
                  {
                    kind: plugin.kind,
                    name: plugin.name,
                    shadowedIndex: prev,
                    winnerIndex: index,
                  },
                ],
              })
              return {
                seen: HashMap.set(inner.seen, key, index),
                shadowings: nextShadowings,
              }
            },
            acc,
          ),
      }),
    { seen: HashMap.empty<string, number>(), shadowings: [] },
  )

  const pluginsByKind = entries.reduce<HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>>(
    (map, entry) =>
      Option.match(Option.fromUndefinedOr(entry.plugins), {
        onNone: () => map,
        onSome: (plugins) =>
          plugins.reduce(
            (inner, plugin) =>
              Option.match(HashMap.get(inner, plugin.kind), {
                onNone: () => HashMap.set(inner, plugin.kind, [plugin]),
                onSome: (existing) => HashMap.set(inner, plugin.kind, [...existing, plugin]),
              }),
            map,
          ),
      }),
    HashMap.empty<PluginKind, readonly PluginDescriptor[]>(),
  )

  const pluginModulePaths = entries.flatMap((entry) =>
    Option.match(Option.fromUndefinedOr(entry.plugins), {
      onNone: () => [],
      onSome: () => [entry.moduleName],
    })
  )

  const schemaContributions = entries.flatMap((entry) =>
    Option.match(Option.fromUndefinedOr(entry.schemaContribution), {
      onNone: () => [],
      onSome: (value) => [value],
    })
  )

  return {
    schemaContributions,
    pluginsByKind,
    pluginModulePaths,
    shadowings: shadowingState.shadowings,
  }
}

const hasErrorMessage = (error: unknown): error is Record<'message', unknown> => Predicate.hasProperty(error, 'message')

const errorMessageOf = (error: unknown): unknown =>
  Match.value(error).pipe(
    Match.when(hasErrorMessage, (carrier: Record<'message', unknown>) => carrier.message),
    Match.orElse(() => undefined),
  )

interface SchemaValidationContribution {
  strykerValidationSchema: Record<string, unknown>
}

export interface LoadedPlugins {
  readonly schemaContributions: readonly Record<string, unknown>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly pluginSources: readonly PluginSource[]
  readonly ignorers: readonly IgnorerDescriptor[]
}

const PROJECT_MANIFEST = 'package.json'

const resolutionFailureReason = (cause: unknown): string =>
  Option.match(Option.fromUndefinedOr(errorMessageOf(cause)), {
    onNone: () => 'the project does not resolve this specifier',
    onSome: (message) => String(message),
  })

const resolveSpecifier = (
  specifier: string,
  requireFrom: ModuleRequire,
): Effect.Effect<ResolvedSpecifier | UnresolvedSpecifier> =>
  Effect.try({
    try: (): string => requireFrom.resolve(specifier),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((entrypoint) => new ResolvedSpecifier({ specifier, entrypoint })),
    Effect.catch((cause: unknown) =>
      Effect.succeed(new UnresolvedSpecifier({ specifier, reason: resolutionFailureReason(cause) }))
    ),
  )

const resolveSpecifiers = (
  specifiers: readonly string[],
  basePath: string,
): Effect.Effect<readonly (ResolvedSpecifier | UnresolvedSpecifier)[], never, Module | Path.Path> =>
  Effect.gen(function*() {
    const module = yield* Module
    const pathService = yield* Path.Path
    const requireFrom = module.createRequire(pathService.join(basePath, PROJECT_MANIFEST))
    return yield* Effect.forEach(specifiers, (specifier: string) => resolveSpecifier(specifier, requireFrom))
  })

const warnUnresolvedSpecifier = (missed: UnresolvedSpecifier): Effect.Effect<void> =>
  Effect.logWarning(
    `Cannot find plugin "${missed.specifier}".\n  Did you forget to install it ?\n  The resolver said: ${missed.reason}`,
  ).pipe(Effect.asVoid)

const reportUnresolvedSpecifiers = (plan: PluginLoadDecision): Effect.Effect<void> =>
  Match.value(plan).pipe(
    Match.tag('PluginsResolved', () => Effect.void),
    Match.tag('PluginsPartiallyResolved', (partial) =>
      Effect.forEach(partial.unresolved, (missed) => warnUnresolvedSpecifier(missed))),
    Match.exhaustive,
  )

interface PluginContributions {
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly ignorers: readonly IgnorerDescriptor[] | undefined
  readonly schemaContribution: Record<string, unknown> | undefined
}

const failPluginLoad = (descriptor: string, error: unknown): Effect.Effect<never, PluginLoadFailedError> =>
  Effect.logWarning(`Error during loading "${descriptor}" plugin`).pipe(
    Effect.andThen(() => Effect.fail(new PluginLoadFailedError({ descriptor, cause: error }))),
  )

const modulePluginContributions = (module: unknown): readonly PluginDescriptor[] | undefined =>
  S.decodeUnknownOption(PluginModuleSchema)(module).pipe(
    Option.map((pluginModule) => pluginModule.strykerPlugins),
    Option.getOrUndefined,
  )

const moduleIgnorers = (
  module: unknown,
): Result.Result<readonly IgnorerDescriptor[] | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerIgnorers')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(IgnorerModuleSchema)(module).pipe(
        Result.map((ignorerModule) => ignorerModule.strykerIgnorers),
      )),
    Match.orElse((): Result.Result<readonly IgnorerDescriptor[] | undefined, S.SchemaError> =>
      Result.succeed(undefined)
    ),
  )

const moduleSchemaContribution = (module: unknown): Record<string, unknown> | undefined =>
  Match.value(module).pipe(
    Match.when(
      hasValidationSchemaContribution,
      (contribution: SchemaValidationContribution) => contribution.strykerValidationSchema,
    ),
    Match.orElse((): undefined => undefined),
  )

const pluginContributionsOf = (
  module: unknown,
): Result.Result<PluginContributions, S.SchemaError> =>
  moduleIgnorers(module).pipe(
    Result.map((ignorers) => ({
      plugins: modulePluginContributions(module),
      ignorers,
      schemaContribution: moduleSchemaContribution(module),
    })),
  )

const hasContribution = (contributions: PluginContributions): boolean =>
  [contributions.plugins, contributions.ignorers, contributions.schemaContribution].some(
    (contribution) => contribution !== undefined,
  )

const warnUndescribedPluginModule = (descriptor: string): Effect.Effect<undefined> =>
  Effect.logWarning(
    `Module "${descriptor}" did not contribute a StrykerJS plugin. It didn't export a "strykerPlugins", "strykerIgnorers", or "strykerValidationSchema".`,
  ).pipe(Effect.as(undefined))

const describeLoadedPlugin = (
  descriptor: string,
  module: unknown,
): Effect.Effect<PluginContributions | undefined, PluginLoadFailedError> =>
  Result.match(pluginContributionsOf(module), {
    onFailure: (cause) => failPluginLoad(descriptor, cause),
    onSuccess: (contributions) =>
      Match.value(hasContribution(contributions)).pipe(
        Match.when(true, () => Effect.succeed<PluginContributions | undefined>(contributions)),
        Match.orElse(() => warnUndescribedPluginModule(descriptor)),
      ),
  })

function loadPlugin(
  descriptor: string,
  basePath: string,
): Effect.Effect<PluginContributions | undefined, PluginLoadFailedError, Module | Path.Path> {
  return Effect.gen(function*() {
    yield* Effect.logDebug(`Loading plugin ${descriptor}`)
    const maybeModule = yield* importModule(descriptor, basePath).pipe(
      Effect.catch((error) => failPluginLoad(descriptor, error)),
    )
    return yield* Option.match(Option.fromUndefinedOr(maybeModule), {
      onNone: () => Effect.succeed(undefined),
      onSome: (module) => describeLoadedPlugin(descriptor, module),
    })
  })
}

interface PluginLoaderRawEntry {
  readonly moduleName: string
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly schemaContribution: Record<string, unknown> | undefined
}
export function loadPlugins(
  pluginDescriptors: readonly string[],
  basePath: string,
): Effect.Effect<LoadedPlugins, PluginLoadFailedError | PluginSelectionError, Module | Path.Path> {
  return Effect.gen(function*() {
    yield* Module
    yield* Path.Path
    const resolutions = yield* resolveSpecifiers(pluginDescriptors, basePath)
    const plan = yield* Effect.fromResult(
      planPluginLoad(new PluginLoadCommand({ specifiers: pluginDescriptors, resolutions })),
    )
    yield* reportUnresolvedSpecifiers(plan)
    const loaded = yield* Effect.forEach(
      plan.toLoad,
      (resolved: ResolvedSpecifier) =>
        loadPlugin(resolved.specifier, basePath).pipe(
          Effect.map((plugin) => {
            if (plugin === undefined) {
              return undefined
            }
            return {
              ...plugin,
              moduleName: resolved.entrypoint,
            }
          }),
        ),
      { concurrency: 'unbounded' },
    ).pipe(Effect.map((arr) => arr.filter(Predicate.isNotNullish)))
    const ignorers: readonly IgnorerDescriptor[] = loaded.flatMap((entry) => entry.ignorers ?? NO_IGNORERS)
    const pluginSources: readonly PluginSource[] = loaded.flatMap((entry) =>
      (entry.plugins ?? []).map((plugin): PluginSource => ({
        kind: plugin.kind,
        name: plugin.name,
        modulePath: entry.moduleName,
      }))
    )
    const entries: readonly PluginLoaderRawEntry[] = loaded.map((entry) => ({
      moduleName: entry.moduleName,
      plugins: entry.plugins,
      schemaContribution: entry.schemaContribution,
    }))
    const plan_ = buildPluginLoadPlan(entries)
    for (const shadowing of plan_.shadowings) {
      yield* Effect.logWarning(
        `Plugin "${shadowing.name}" of kind "${shadowing.kind}" at index ${shadowing.winnerIndex} shadows plugin at index ${shadowing.shadowedIndex}.`,
      )
    }
    const result: LoadedPlugins = {
      schemaContributions: plan_.schemaContributions,
      pluginsByKind: plan_.pluginsByKind,
      pluginModulePaths: plan_.pluginModulePaths,
      pluginSources,
      ignorers,
    }
    return result
  })
}

function hasValidationSchemaContribution(module: unknown): module is SchemaValidationContribution {
  return S.is(SchemaValidationContributionSchema)(module)
}

const findContribution = <K extends PluginKind>(
  descriptors: readonly AnyPluginDescriptor[],
  kind: K,
  name: string,
): Effect.Effect<PluginDescriptorOf<K>, PluginNotFoundError> =>
  Option.match(
    Option.fromUndefinedOr(
      descriptors.find(
        (descriptor): descriptor is PluginDescriptorOf<K> =>
          descriptor.kind === kind && descriptor.name.toLowerCase() === name.toLowerCase(),
      ),
    ),
    {
      onNone: () =>
        Effect.fail(
          new PluginNotFoundError({
            descriptor: `${kind}:${name} (available: ${descriptors.map((d) => d.name).join(', ')})`,
          }),
        ),
      onSome: (found) => Effect.succeed(found),
    },
  )

function findPlugin<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginDescriptor[]>,
  kind: K,
  name: string,
): Effect.Effect<PluginDescriptorOf<K>, PluginNotFoundError> {
  return Option.match(HashMap.get(pluginsByKind, kind), {
    onNone: () =>
      Effect.fail(
        new PluginNotFoundError({ descriptor: `${kind}:${name} (no ${kind} plugins were loaded)` }),
      ),
    onSome: (descriptors) => findContribution(descriptors, kind, name),
  })
}

export function create<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginDescriptor[]>,
  kind: K,
  name: string,
): Effect.Effect<PluginDescriptorOf<K>, PluginNotFoundError> {
  return findPlugin(pluginsByKind, kind, name)
}

export function createAll<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginDescriptor[]>,
  kind: K,
): Effect.Effect<readonly PluginDescriptorOf<K>[]> {
  const descriptors = HashMap.get(pluginsByKind, kind)
  if (Option.isNone(descriptors)) {
    return Effect.succeed([])
  }
  return Effect.succeed(descriptors.value.filter((d): d is PluginDescriptorOf<K> => d.kind === kind))
}
