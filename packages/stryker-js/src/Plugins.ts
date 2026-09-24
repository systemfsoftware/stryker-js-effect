import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import type { Framework, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import type { Ignorer as IgnorerDescriptor } from '@systemfsoftware/stryker-ignorer-interface'
import {
  isCustomTestRunner,
  type StrykerOptions,
  type WorkerPluginKind,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as FileSystem from 'effect/FileSystem'
import { importModule } from './run/load-config.cell.js'
import { PackageManifestFields } from './run/package-manifest.schema.js'
import { selectPackageEntry, SelectPackageEntryCommand } from './run/select-package-entry.workflow.js'

import {
  type FrameworkModuleContributions,
  FrameworkModuleSchema,
  IgnorerModuleSchema,
  PluginLoadRefusedError,
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

export interface PluginLoaderEntryLike<A = unknown> {
  readonly moduleName: string
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly schemaContribution: Record<string, A> | undefined
}

export interface PluginLoadPlan<A = unknown> {
  readonly schemaContributions: readonly Record<string, A>[]
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

interface SchemaValidationContribution<A = unknown> {
  strykerValidationSchema: Record<string, A>
}

export interface LoadedPlugins<A = unknown> {
  readonly schemaContributions: readonly Record<string, A>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly pluginSources: readonly PluginSource[]
  readonly ignorers: readonly IgnorerDescriptor[]
  readonly frameworks: readonly {
    readonly moduleName: string
    readonly framework: Framework
  }[]
}
interface PluginContributions<A = unknown> {
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly ignorers: readonly IgnorerDescriptor[] | undefined
  readonly frameworks: FrameworkModuleContributions | undefined
  readonly schemaContribution: Record<string, A> | undefined
}

interface LoadedContribution extends Omit<PluginContributions, 'frameworks'> {
  readonly frameworks: readonly Framework[]
}

const messageOf = (cause: S.SchemaError): string => cause.message

const invalidContribution = (descriptor: string, cause: S.SchemaError): PluginLoadRefusedError =>
  PluginLoadRefusedError.make({
    descriptor,
    reason: { _tag: 'InvalidContribution', detail: messageOf(cause) },
  })

const importFailure = <A = unknown>(descriptor: string, crash: { readonly cause: A }): PluginLoadRefusedError =>
  PluginLoadRefusedError.make({ descriptor, reason: { _tag: 'ImportFailed', cause: crash.cause } })

const failPluginLoad = (
  descriptor: string,
  error: PluginLoadRefusedError,
): Effect.Effect<never, PluginLoadRefusedError> =>
  Effect.logWarning(`Error during loading "${descriptor}" plugin`).pipe(
    Effect.annotateLogs('cause', error),
    Effect.andThen(() => Effect.fail(error)),
  )

const moduleFrameworks = <A = unknown>(
  module: A,
): Result.Result<FrameworkModuleContributions | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerFrameworks')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(FrameworkModuleSchema)(module).pipe(
        Result.map(
          (frameworkModule): FrameworkModuleContributions => [...frameworkModule.strykerFrameworks],
        ),
      )),
    Match.orElse((): Result.Result<FrameworkModuleContributions | undefined, S.SchemaError> =>
      Result.succeed(undefined)
    ),
  )

const modulePluginContributions = <A = unknown>(
  module: A,
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

const moduleIgnorers = <A = unknown>(
  module: A,
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

const moduleSchemaContribution = <A = unknown, S = unknown>(module: A): Record<string, S> | undefined => {
  if (hasValidationSchemaContribution<S>(module)) {
    return module.strykerValidationSchema
  }
  return undefined
}

const pluginContributionsOf = <A = unknown>(module: A): Result.Result<PluginContributions, S.SchemaError> =>
  Result.flatMap(
    moduleIgnorers(module),
    (ignorers) =>
      Result.flatMap(
        moduleFrameworks(module),
        (frameworks) =>
          Result.map(modulePluginContributions(module), (plugins): PluginContributions => ({
            plugins,
            ignorers,
            frameworks,
            schemaContribution: moduleSchemaContribution(module),
          })),
      ),
  )

const hasContribution = (contributions: PluginContributions): boolean =>
  [contributions.plugins, contributions.ignorers, contributions.frameworks, contributions.schemaContribution].some(
    (contribution) => contribution !== undefined,
  )

const moduleFrameworkRefusalError = (descriptor: string, refusal: FrameworkRefusal): PluginLoadRefusedError =>
  Match.value(refusal.reason).pipe(
    Match.when(
      'PeerMissing',
      () => PluginLoadRefusedError.make({ descriptor, reason: { _tag: 'PeerMissing', peer: refusal.peer } }),
    ),
    Match.when(
      'PeerVersionUnsupported',
      () =>
        PluginLoadRefusedError.make({
          descriptor,
          reason: { _tag: 'PeerVersionUnsupported', peer: refusal.peer, detail: refusal.detail },
        }),
    ),
    Match.when(
      'PeerUnrecognized',
      () => PluginLoadRefusedError.make({ descriptor, reason: { _tag: 'PeerUnrecognized', peer: refusal.peer } }),
    ),
    Match.exhaustive,
  )

const frameworkRefusalsOf = (
  descriptor: string,
  contributions: FrameworkModuleContributions,
): Effect.Effect<readonly Framework[], PluginLoadRefusedError> =>
  Effect.forEach(contributions, (contribution) =>
    Match.value(contribution).pipe(
      Match.when({ kind: 'FrameworkRefusal' }, (refusal) =>
        Effect.fail(moduleFrameworkRefusalError(descriptor, refusal))),
      Match.when({ kind: 'Framework' }, (framework) =>
        Effect.succeed(framework)),
      Match.exhaustive,
    ))

const warnUndescribedPluginModule = (descriptor: string): Effect.Effect<undefined> =>
  Effect.logWarning(
    `Module "${descriptor}" did not contribute a StrykerJS plugin. It didn't export a "strykerPlugins", "strykerIgnorers", "strykerFrameworks", or "strykerValidationSchema".`,
  ).pipe(Effect.as(undefined))

const describeLoadedPlugin = <A = unknown>(
  descriptor: string,
  module: A,
): Effect.Effect<LoadedContribution | undefined, PluginLoadRefusedError> =>
  Result.match(pluginContributionsOf(module), {
    onFailure: (cause) => failPluginLoad(descriptor, invalidContribution(descriptor, cause)),
    onSuccess: (contributions) =>
      Match.value(hasContribution(contributions)).pipe(
        Match.when(true, () =>
          frameworkRefusalsOf(descriptor, contributions.frameworks ?? []).pipe(
            Effect.map((frameworks): LoadedContribution => ({ ...contributions, frameworks })),
          )),
        Match.orElse(() => warnUndescribedPluginModule(descriptor)),
      ),
  })

function loadPlugin(
  descriptor: string,
  entrypoint: string,
): Effect.Effect<LoadedContribution | undefined, PluginLoadRefusedError> {
  return Effect.gen(function*() {
    yield* Effect.logDebug(`Loading plugin ${descriptor}`)
    const maybeModule = yield* importModule(entrypoint).pipe(
      Effect.catch((error) => failPluginLoad(descriptor, importFailure(descriptor, { cause: error }))),
    )
    const module = Option.getOrUndefined(Option.fromUndefinedOr(maybeModule))
    if (module === undefined) {
      return undefined
    }
    return yield* describeLoadedPlugin(descriptor, module)
  })
}

interface PluginLoaderRawEntry<A = unknown> {
  readonly moduleName: string
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly schemaContribution: Record<string, A> | undefined
}
const fileUrlOf = (specifier: string): Option.Option<URL> => {
  try {
    const url = new URL(specifier)
    return Option.filter(Option.some(url), (parsed) => parsed.protocol === 'file:')
  } catch {
    return Option.none()
  }
}

const manifestRefusalOf = (specifier: string): PluginLoadRefusedError =>
  importFailure(specifier, {
    cause: new Error(`the package.json of "${specifier}" is not a manifest`),
  })

const parseAndDecodeManifest = S.decodeUnknownResult(S.fromJsonString(PackageManifestFields))

const parsedManifestOf = (
  specifier: string,
  text: string,
): Effect.Effect<string, PluginLoadRefusedError> =>
  Result.match(parseAndDecodeManifest(text), {
    onFailure: () => Effect.fail(manifestRefusalOf(specifier)),
    onSuccess: (fields) => selectManifestFields(specifier, fields),
  })

const selectManifestFields = (
  specifier: string,
  fields: PackageManifestFields,
): Effect.Effect<string, PluginLoadRefusedError> =>
  Effect.flatMap(
    Effect.fromResult(selectPackageEntry(SelectPackageEntryCommand.make({ specifier, manifest: fields }))),
    (
      decision,
    ) =>
      Match.value(decision).pipe(
        Match.tag('PackageEntrySelected', (selected) => Effect.succeed(selected.entry)),
        Match.tag(
          'PackageEntryUnresolved',
          (unresolved) => Effect.fail(importFailure(specifier, { cause: new Error(unresolved.reason) })),
        ),
        Match.exhaustive,
      ),
  )

const manifestOf = (
  specifier: string,
  manifestPath: string,
): Effect.Effect<string, PluginLoadRefusedError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.flatMap(
      fs.readFileString(manifestPath).pipe(
        Effect.mapError((cause) =>
          importFailure(specifier, {
            cause: new Error(`the package.json of "${specifier}" is not readable`, { cause }),
          })
        ),
      ),
      (text) => parsedManifestOf(specifier, text),
    ))

const packageAnchorOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<URL, PluginLoadRefusedError, Path.Path> =>
  Effect.flatMap(
    Path.Path,
    (path) =>
      Effect.mapError(path.toFileUrl(path.join(basePath, 'package.json')), (cause) =>
        importFailure(specifier, { cause })),
  )

const foundManifestPathOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<string, PluginLoadRefusedError, Path.Path> =>
  Effect.flatMap(packageAnchorOf(specifier, basePath), (anchor) =>
    Effect.flatMap(
      Effect.try({
        try: () =>
          Option.fromUndefinedOr(
            globalThis.process.getBuiltinModule('node:module').findPackageJSON(specifier, anchor.href),
          ),
        catch: () => Option.none<string>(),
      }),
      (found) =>
        Effect.fromOption(found, () =>
          importFailure(specifier, { cause: new Error(`the package "${specifier}" is not installed`) })),
    ).pipe(Effect.mapError((cause) =>
      importFailure(specifier, { cause })
    )))

const resolveBareSpecifierOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<string, PluginLoadRefusedError, Path.Path> =>
  Effect.flatMap(packageAnchorOf(specifier, basePath), (anchor) =>
    Effect.mapError(
      Effect.try({
        try: () => globalThis.process.getBuiltinModule('node:module').createRequire(anchor.href).resolve(specifier),
        catch: (): PluginLoadRefusedError =>
          importFailure(specifier, { cause: new Error(`the package "${specifier}" did not resolve`) }),
      }),
      (cause) => cause,
    ))

const packageEntrypointOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<URL, PluginLoadRefusedError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const manifestPath = yield* foundManifestPathOf(specifier, basePath)
    const resolved = yield* resolveBareSpecifierOf(specifier, basePath)
    const entry = yield* manifestOf(specifier, manifestPath)
    const joined = path.join(path.dirname(manifestPath), entry)
    const selected = resolved.endsWith(entry) ? resolved : joined
    return yield* Effect.mapError(path.toFileUrl(selected), (cause) => importFailure(specifier, { cause }))
  })

const entrypointOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<URL, PluginLoadRefusedError, FileSystem.FileSystem | Path.Path> =>
  Option.match(fileUrlOf(specifier), {
    onSome: (url) => Effect.succeed(url),
    onNone: () => packageEntrypointOf(specifier, basePath),
  })

export function loadPlugins(
  pluginDescriptors: readonly string[],
  basePath: string,
): Effect.Effect<LoadedPlugins, PluginLoadRefusedError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function*() {
    const entrypoints = yield* Effect.forEach(
      Array.dedupe(pluginDescriptors),
      (specifier) => Effect.map(entrypointOf(specifier, basePath), (entrypoint) => ({ specifier, entrypoint })),
      { concurrency: 'unbounded' },
    )
    const loaded = yield* Effect.forEach(
      entrypoints,
      (resolved) =>
        loadPlugin(resolved.specifier, resolved.entrypoint.href).pipe(
          Effect.map((plugin) => {
            if (plugin === undefined) {
              return undefined
            }
            return {
              ...plugin,
              moduleName: resolved.specifier,
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
      frameworks: loaded.flatMap((entry) =>
        entry.frameworks.map((framework) => ({
          moduleName: entry.moduleName,
          framework,
        }))
      ),
    }
    return result
  })
}

export const pluginUrlsFromOptions = (options: StrykerOptions): readonly string[] => [
  ...options.plugins,
  ...options.appendPlugins,
  ...options.ignorers,
  ...Match.value(options.testRunner).pipe(
    Match.when(isCustomTestRunner, (runner) => [runner.plugin]),
    Match.orElse(() => []),
  ),
  ...options.checkers.map((checker) => checker.plugin),
]

function hasValidationSchemaContribution<A = unknown>(module: unknown): module is SchemaValidationContribution<A> {
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
  Effect.fromOption(
    Option.filter(
      findByKindAndName(descriptors, kind, name),
      (descriptor): descriptor is PluginDescriptorOf<K> => descriptor.kind === kind,
    ),
    () =>
      PluginNotFoundError.make({
        descriptor: `${kind}:${name} (available: ${descriptors.map((d) => d.name).join(', ')})`,
      }),
  )

function findPlugin<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginDescriptor[]>,
  kind: K,
  name: string,
): Effect.Effect<PluginDescriptorOf<K>, PluginNotFoundError> {
  return Option.match(HashMap.get(pluginsByKind, kind), {
    onNone: () =>
      Effect.fail(
        PluginNotFoundError.make({ descriptor: `${kind}:${name} (no ${kind} plugins were loaded)` }),
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
