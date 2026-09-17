import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import type { Ignorer as IgnorerDescriptor } from '@systemfsoftware/stryker-ignorer-interface'
import type { WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import { importModule } from './Config.js'
import type { PluginLoadDecision, PluginSelectionError } from './plan-plugin-load.workflow.js'
import {
  PathPrefixedSpecifier,
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

export interface WorkerPluginDescriptor<K extends WorkerPluginKind = WorkerPluginKind> {
  readonly kind: K
  readonly name: string
  readonly workerEntry: string
}

export interface EvaluatorPluginDescriptor {
  readonly kind: 'Evaluator'
  readonly name: string
}

export type AnyWorkerPluginDescriptor = {
  [K in WorkerPluginKind]: WorkerPluginDescriptor<K>
}[WorkerPluginKind]

export type AnyPluginDescriptor = AnyWorkerPluginDescriptor | EvaluatorPluginDescriptor

export type PluginDescriptorOf<K extends PluginKind> = Extract<AnyPluginDescriptor, { readonly kind: K }>

export type PluginDescriptor<K extends PluginKind = PluginKind> = PluginDescriptorOf<K>

export interface WorkerPluginSource<K extends WorkerPluginKind = WorkerPluginKind> {
  readonly kind: K
  readonly name: string
  readonly modulePath: string
  readonly workerEntry: string
}

export interface EvaluatorPluginSource {
  readonly kind: 'Evaluator'
  readonly name: string
  readonly modulePath: string
}

export type AnyWorkerPluginSource = {
  [K in WorkerPluginKind]: WorkerPluginSource<K>
}[WorkerPluginKind]

export type PluginSource = AnyWorkerPluginSource | EvaluatorPluginSource

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
  readonly pluginSources: readonly PluginSource[]
  readonly shadowings: readonly {
    readonly kind: PluginKind
    readonly name: string
    readonly shadowedIndex: number
    readonly winnerIndex: number
  }[]
}

export const buildPluginLoadPlan = (entries: readonly PluginLoaderEntryLike[]): PluginLoadPlan => {
  const declarations: readonly { plugin: PluginDescriptor; moduleName: string; entryIndex: number }[] = entries.flatMap(
    (entry, index) =>
      (entry.plugins ?? []).map((plugin) => ({ plugin, moduleName: entry.moduleName, entryIndex: index })),
  )

  const shadowingState = declarations.reduce<{
    readonly seen: HashMap.HashMap<string, { readonly position: number; readonly entryIndex: number }>
    readonly shadowings: readonly {
      readonly kind: PluginKind
      readonly name: string
      readonly shadowedIndex: number
      readonly winnerIndex: number
    }[]
  }>(
    (acc, declaration, position) => {
      const key = `${declaration.plugin.kind}:${declaration.plugin.name}`
      return {
        seen: HashMap.set(acc.seen, key, { position, entryIndex: declaration.entryIndex }),
        shadowings: Option.match(HashMap.get(acc.seen, key), {
          onNone: () => acc.shadowings,
          onSome: (previous) => [
            ...acc.shadowings,
            {
              kind: declaration.plugin.kind,
              name: declaration.plugin.name,
              shadowedIndex: previous.entryIndex,
              winnerIndex: declaration.entryIndex,
            },
          ],
        }),
      }
    },
    { seen: HashMap.empty<string, { readonly position: number; readonly entryIndex: number }>(), shadowings: [] },
  )

  const winningDeclarations = declarations.filter((declaration, position) =>
    Option.match(HashMap.get(shadowingState.seen, `${declaration.plugin.kind}:${declaration.plugin.name}`), {
      onNone: () => false,
      onSome: (winner) => winner.position === position,
    })
  )

  const pluginsByKind = winningDeclarations.reduce<HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>>(
    (map, declaration) =>
      Option.match(HashMap.get(map, declaration.plugin.kind), {
        onNone: () => HashMap.set(map, declaration.plugin.kind, [declaration.plugin]),
        onSome: (existing) => HashMap.set(map, declaration.plugin.kind, [...existing, declaration.plugin]),
      }),
    HashMap.empty<PluginKind, readonly PluginDescriptor[]>(),
  )

  const pluginSources = winningDeclarations.map((declaration): PluginSource =>
    Match.value(declaration.plugin).pipe(
      Match.when(
        (plugin): plugin is EvaluatorPluginDescriptor => plugin.kind === 'Evaluator',
        (evaluator): PluginSource => ({
          kind: 'Evaluator',
          name: evaluator.name,
          modulePath: declaration.moduleName,
        }),
      ),
      Match.orElse((worker): PluginSource => ({
        kind: worker.kind,
        name: worker.name,
        modulePath: declaration.moduleName,
        workerEntry: worker.workerEntry,
      })),
    )
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
    pluginSources,
    shadowings: shadowingState.shadowings,
  }
}

const hasErrorCode = (error: unknown): error is Record<'code', unknown> => Predicate.hasProperty(error, 'code')

const errorCodeOf = (error: unknown): unknown =>
  Match.value(error).pipe(
    Match.when(hasErrorCode, (carrier: Record<'code', unknown>) => carrier.code),
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

const resolutionFailureReason = (cause: unknown): string =>
  Option.match(Option.fromUndefinedOr(errorCodeOf(cause)), {
    onNone: () => 'the project does not resolve this specifier',
    onSome: (code) => String(code),
  })

const resolveSpecifier = (specifier: string): Effect.Effect<ResolvedSpecifier | UnresolvedSpecifier> =>
  Effect.try({
    try: (): ResolvedSpecifier => new ResolvedSpecifier({ specifier, entrypoint: import.meta.resolve(specifier) }),
    catch: (cause) => new UnresolvedSpecifier({ specifier, reason: resolutionFailureReason(cause) }),
  }).pipe(Effect.catch((missed) => Effect.succeed<ResolvedSpecifier | UnresolvedSpecifier>(missed)))

const resolveSpecifiers = (
  specifiers: readonly string[],
): Effect.Effect<readonly (ResolvedSpecifier | UnresolvedSpecifier)[]> => Effect.forEach(specifiers, resolveSpecifier)

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

const modulePluginContributions = (
  module: unknown,
): Result.Result<readonly PluginDescriptor[] | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerPlugins')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(PluginModuleSchema)(module).pipe(
        Result.map((pluginModule) => pluginModule.strykerPlugins),
      )),
    Match.orElse((): Result.Result<readonly PluginDescriptor[] | undefined, S.SchemaError> =>
      Result.succeed(undefined)
    ),
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
  Result.flatMap(moduleIgnorers(module), (ignorers) =>
    Result.map(modulePluginContributions(module), (plugins) => ({
      plugins,
      ignorers,
      schemaContribution: moduleSchemaContribution(module),
    })))

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
  entrypoint: string,
): Effect.Effect<PluginContributions | undefined, PluginLoadFailedError> {
  return Effect.gen(function*() {
    yield* Effect.logDebug(`Loading plugin ${descriptor}`)
    const maybeModule = yield* importModule(entrypoint).pipe(
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
): Effect.Effect<LoadedPlugins, PluginLoadFailedError | PluginSelectionError> {
  return Effect.gen(function*() {
    const resolutions = yield* resolveSpecifiers(
      pluginDescriptors.filter((specifier) => !S.is(PathPrefixedSpecifier)(specifier)),
    )
    const plan = yield* Effect.fromResult(
      planPluginLoad(new PluginLoadCommand({ specifiers: pluginDescriptors, resolutions })),
    )
    yield* reportUnresolvedSpecifiers(plan)
    const loaded = yield* Effect.forEach(
      plan.toLoad,
      (resolved: ResolvedSpecifier) =>
        loadPlugin(resolved.specifier, resolved.entrypoint).pipe(
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
      pluginSources: plan_.pluginSources,
      ignorers,
    }
    return result
  })
}

function hasValidationSchemaContribution(module: unknown): module is SchemaValidationContribution {
  return S.is(SchemaValidationContributionSchema)(module)
}

export const findByKindAndName = <T extends { readonly kind: PluginKind; readonly name: string }, K extends T['kind']>(
  items: readonly T[],
  kind: K,
  name: string,
): Option.Option<T & { readonly kind: K }> =>
  Option.fromUndefinedOr(
    items.find(
      (item): item is T & { readonly kind: K } => item.kind === kind && item.name.toLowerCase() === name.toLowerCase(),
    ),
  )

const findContribution = <K extends PluginKind>(
  descriptors: readonly AnyPluginDescriptor[],
  kind: K,
  name: string,
): Effect.Effect<PluginDescriptorOf<K>, PluginNotFoundError> =>
  Option.match(
    Option.filter(
      findByKindAndName(descriptors, kind, name),
      (descriptor): descriptor is PluginDescriptorOf<K> => descriptor.kind === kind,
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
