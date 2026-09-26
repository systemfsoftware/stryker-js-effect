import type { Framework, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { importModule } from './drivers/config.js'
import {
  planPluginLoad,
  type PluginDeclaration,
  PluginDeclarationsPlanned,
  PluginLoadCommand,
  type PluginLoadDecision,
  type PluginShadowing,
} from './plan-plugin-load.workflow.js'
import {
  type EvaluatorPluginDescriptor,
  type FrameworkModuleContributions,
  FrameworkModuleSchema,
  IgnorerModuleSchema,
  type LoadedPlugins,
  type PluginDescriptor,
  type PluginKind,
  PluginModuleSchema,
  type PluginSource,
  SchemaValidationContributionSchema,
} from './Plugins.schema.js'
import { PluginLoadRefusedError } from './PluginsError.schema.js'
import { PackageManifestFields } from './run/package-manifest.schema.js'
import { selectPackageEntry, SelectPackageEntryCommand } from './run/select-package-entry.workflow.js'
import { isVmRunner, vmRunnerPluginUrl } from './vm-runner.js'

const NO_IGNORERS: readonly Ignorer[] = []

type ValidationSchemaProperties = S.Schema.Type<typeof SchemaValidationContributionSchema>['strykerValidationSchema']

interface PluginLoaderEntry {
  readonly moduleName: string
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly schemaContribution: ValidationSchemaProperties | undefined
}

interface PluginLoadPlan {
  readonly schemaContributions: readonly ValidationSchemaProperties[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginDescriptor[]>
  readonly pluginModulePaths: readonly string[]
  readonly pluginSources: readonly PluginSource[]
  readonly shadowings: readonly PluginShadowing[]
}

const plannedOf = (decision: Result.Result<PluginLoadDecision, never>): Option.Option<PluginDeclarationsPlanned> =>
  Option.filter(Result.getSuccess(decision), S.is(PluginDeclarationsPlanned))

const buildPluginLoadPlan = (entries: readonly PluginLoaderEntry[]): PluginLoadPlan => {
  const declarations: readonly PluginDeclaration[] = entries.flatMap((entry, index) =>
    (entry.plugins ?? []).map((plugin) => ({ plugin, moduleName: entry.moduleName, entryIndex: index }))
  )
  const planned = plannedOf(planPluginLoad(PluginLoadCommand.make({ declarations: [...declarations] })))
  const winningDeclarations: readonly PluginDeclaration[] = Option.getOrElse(
    Option.map(planned, (plan) => [...plan.winners]),
    (): readonly PluginDeclaration[] => [],
  )
  const shadowings: readonly PluginShadowing[] = Option.getOrElse(
    Option.map(planned, (plan) => [...plan.shadowings]),
    (): readonly PluginShadowing[] => [],
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
    shadowings,
  }
}

interface PluginContributions {
  readonly plugins: readonly PluginDescriptor[] | undefined
  readonly ignorers: readonly Ignorer[] | undefined
  readonly frameworks: FrameworkModuleContributions | undefined
  readonly schemaContribution: ValidationSchemaProperties | undefined
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

const modulePluginContributions = (
  module: object,
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

const moduleIgnorers = (module: object): Result.Result<readonly Ignorer[] | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerIgnorers')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(IgnorerModuleSchema)(module).pipe(
        Result.map((ignorerModule) => ignorerModule.strykerIgnorers),
      )),
    Match.orElse((): Result.Result<readonly Ignorer[] | undefined, S.SchemaError> => Result.succeed(undefined)),
  )

const moduleFrameworks = (
  module: object,
): Result.Result<FrameworkModuleContributions | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerFrameworks')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(FrameworkModuleSchema)(module).pipe(
        Result.map((frameworkModule): FrameworkModuleContributions => [...frameworkModule.strykerFrameworks]),
      )),
    Match.orElse((): Result.Result<FrameworkModuleContributions | undefined, S.SchemaError> =>
      Result.succeed(undefined)
    ),
  )

const hasValidationSchemaContribution = (
  module: object,
): module is S.Schema.Type<typeof SchemaValidationContributionSchema> =>
  S.is(SchemaValidationContributionSchema)(module)

const moduleSchemaContribution = (module: object): ValidationSchemaProperties | undefined =>
  Option.getOrUndefined(
    Option.map(
      Option.liftPredicate(hasValidationSchemaContribution)(module),
      (guarded) => guarded.strykerValidationSchema,
    ),
  )

const pluginContributionsOf = (
  module: object,
): Result.Result<PluginContributions, S.SchemaError> =>
  Result.flatMap(
    moduleIgnorers(module),
    (ignorers) =>
      Result.flatMap(moduleFrameworks(module), (frameworks) =>
        Result.map(modulePluginContributions(module), (plugins) => ({
          plugins,
          ignorers,
          frameworks,
          schemaContribution: moduleSchemaContribution(module),
        }))),
  )

const hasContribution = (contributions: PluginContributions): boolean =>
  [contributions.plugins, contributions.ignorers, contributions.frameworks, contributions.schemaContribution].some(
    (contribution) => contribution !== undefined,
  )

const moduleFrameworkRefusalError = (
  descriptor: string,
  refusal: FrameworkRefusal,
): PluginLoadRefusedError =>
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

const describeLoadedPlugin = (
  descriptor: string,
  module: object,
): Effect.Effect<Option.Option<LoadedContribution>, PluginLoadRefusedError> =>
  Result.match(pluginContributionsOf(module), {
    onFailure: (cause) =>
      Effect.as(failPluginLoad(descriptor, invalidContribution(descriptor, cause)), Option.none<LoadedContribution>()),
    onSuccess: (contributions) =>
      Match.value(hasContribution(contributions)).pipe(
        Match.when(true, () =>
          Effect.map(
            frameworkRefusalsOf(descriptor, contributions.frameworks ?? []),
            (frameworks): Option.Option<LoadedContribution> => Option.some({ ...contributions, frameworks }),
          )),
        Match.orElse(() => Effect.as(warnUndescribedPluginModule(descriptor), Option.none<LoadedContribution>())),
      ),
  })

const loadPlugin = (
  descriptor: string,
  entrypoint: string,
): Effect.Effect<Option.Option<LoadedContribution>, PluginLoadRefusedError> =>
  Effect.gen(function*() {
    yield* Effect.logDebug(`Loading plugin ${descriptor}`)
    const maybeModule = yield* importModule<object>(entrypoint).pipe(
      Effect.catch((error) => failPluginLoad(descriptor, importFailure(descriptor, { cause: error }))),
    )
    return yield* Option.match(Option.fromUndefinedOr(maybeModule), {
      onNone: () => Effect.succeedNone,
      onSome: (module) => describeLoadedPlugin(descriptor, module),
    })
  })

const fileUrlOf = (specifier: string): Option.Option<URL> =>
  Result.match(
    Result.try(() => new URL(specifier)),
    {
      onFailure: () => Option.none(),
      onSuccess: (url) => Option.filter(Option.some(url), (parsed) => parsed.protocol === 'file:'),
    },
  )

const manifestRefusalOf = (specifier: string): PluginLoadRefusedError =>
  importFailure(specifier, {
    cause: new Error(`the package.json of "${specifier}" is not a manifest`),
  })

const parseAndDecodeManifest = S.decodeUnknownResult(S.fromJsonString(PackageManifestFields))

const selectManifestFields = (
  specifier: string,
  fields: PackageManifestFields,
): Effect.Effect<string, PluginLoadRefusedError> =>
  Effect.flatMap(
    Effect.fromResult(selectPackageEntry(SelectPackageEntryCommand.make({ specifier, manifest: fields }))),
    (decision) =>
      Match.value(decision).pipe(
        Match.tag('PackageEntrySelected', (selected) => Effect.succeed(selected.entry)),
        Match.tag(
          'PackageEntryUnresolved',
          (unresolved) => Effect.fail(importFailure(specifier, { cause: new Error(unresolved.reason) })),
        ),
        Match.exhaustive,
      ),
  )

const parsedManifestOf = (
  specifier: string,
  text: string,
): Effect.Effect<string, PluginLoadRefusedError> =>
  Result.match(parseAndDecodeManifest(text), {
    onFailure: () => Effect.fail(manifestRefusalOf(specifier)),
    onSuccess: (fields) => selectManifestFields(specifier, fields),
  })

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
        try: (): Option.Option<string> =>
          Option.fromUndefinedOr(
            globalThis.process.getBuiltinModule('node:module').findPackageJSON(specifier, anchor.href),
          ),
        catch: () => Option.none<string>(),
      }).pipe(Effect.orElseSucceed(() => Option.none<string>())),
      (found) =>
        Effect.fromOption(
          found,
          () => importFailure(specifier, { cause: new Error(`the package "${specifier}" is not installed`) }),
        ),
    ))

const resolveBareSpecifierOf = (
  specifier: string,
  basePath: string,
): Effect.Effect<string, PluginLoadRefusedError, Path.Path> =>
  Effect.flatMap(packageAnchorOf(specifier, basePath), (anchor) =>
    Effect.try({
      try: () => globalThis.process.getBuiltinModule('node:module').createRequire(anchor.href).resolve(specifier),
      catch: (): PluginLoadRefusedError =>
        importFailure(specifier, { cause: new Error(`the package "${specifier}" did not resolve`) }),
    }))

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

export const loadPlugins: {
  (basePath: string): (pluginDescriptors: readonly string[]) => Effect.Effect<
    LoadedPlugins,
    PluginLoadRefusedError,
    FileSystem.FileSystem | Path.Path
  >
  (
    pluginDescriptors: readonly string[],
    basePath: string,
  ): Effect.Effect<LoadedPlugins, PluginLoadRefusedError, FileSystem.FileSystem | Path.Path>
} = dual(
  2,
  (
    pluginDescriptors: readonly string[],
    basePath: string,
  ): Effect.Effect<LoadedPlugins, PluginLoadRefusedError, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function*() {
      const entrypoints = yield* Effect.forEach(
        Array.dedupe(pluginDescriptors),
        (specifier) => Effect.map(entrypointOf(specifier, basePath), (entrypoint) => ({ specifier, entrypoint })),
        { concurrency: 'unbounded' },
      )
      const loaded = yield* Effect.forEach(
        entrypoints,
        (resolved) =>
          loadPlugin(resolved.specifier, resolved.entrypoint.href).pipe(
            Effect.map((plugin) =>
              Option.match(plugin, {
                onNone: () => undefined,
                onSome: (contributions) => ({ ...contributions, moduleName: resolved.specifier }),
              })
            ),
          ),
        { concurrency: 'unbounded' },
      ).pipe(Effect.map((arr) => arr.filter(Predicate.isNotNullish)))
      const ignorers: readonly Ignorer[] = loaded.flatMap((entry) => entry.ignorers ?? NO_IGNORERS)
      const entries: readonly PluginLoaderEntry[] = loaded.map((entry) => ({
        moduleName: entry.moduleName,
        plugins: entry.plugins,
        schemaContribution: entry.schemaContribution,
      }))
      const plan = buildPluginLoadPlan(entries)
      yield* Effect.forEach(
        plan.shadowings,
        (shadowing) =>
          Effect.logWarning(
            `Plugin "${shadowing.name}" of kind "${shadowing.kind}" at index ${shadowing.winnerIndex} shadows plugin at index ${shadowing.shadowedIndex}.`,
          ),
        { concurrency: 1 },
      )
      const result: LoadedPlugins = {
        schemaContributions: plan.schemaContributions,
        pluginsByKind: plan.pluginsByKind,
        pluginModulePaths: plan.pluginModulePaths,
        pluginSources: plan.pluginSources,
        ignorers,
        frameworks: loaded.flatMap((entry) =>
          entry.frameworks.map((framework) => ({
            moduleName: entry.moduleName,
            framework,
          }))
        ),
      }
      return result
    }),
)

export const pluginUrlsFromOptions = (options: Options.StrykerOptions): readonly string[] => [
  ...options.plugins,
  ...options.appendPlugins,
  ...options.ignorers,
  ...Match.value(options.testRunner).pipe(
    Match.when(Options.isCustomTestRunner, (runner) => [runner.plugin]),
    Match.when(isVmRunner, () => [vmRunnerPluginUrl()]),
    Match.orElse(() => []),
  ),
  ...options.checkers.map((checker) => checker.plugin),
]
