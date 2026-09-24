import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Framework, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, Plugin, type Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { type RunEvent } from '../run-events.service.js'
import { FormatRegistryResolved, PhaseEntered, PluginsReported, RunFailed } from '../run-events.service.js'
import { RunEvents } from '../run-events.service.js'

import {
  type EvaluatorPluginDescriptor,
  FrameworkManifestSchema,
  type FrameworkModuleContributions,
  FrameworkModuleSchema,
  IgnorerModuleSchema,
  type LoadedPlugins,
  type PluginDescriptor,
  type PluginKind,
  PluginModuleSchema,
  type PluginSource,
  ProjectDependencies,
  SchemaValidationContributionSchema,
} from '../Plugins.schema.js'
import { type PluginLoadFailureReason, PluginLoadRefusedError, PluginNotFoundError } from '../PluginsError.schema.js'
import type { Project } from '../Project.schema.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import {
  attachReporterFactories,
  type AttachReporterInput,
  currentReporterInit,
  type ReporterStage,
  reporterWorkerFactory,
  spawnReporterWorker,
  validateReporterNames,
  withPhaseSpan,
} from '../reporter-stream.service.js'
import { Reporter } from '../reporter.service.js'
import { AnsiCode } from '../reporting/ansi.schema.js'
import { StreamSchemaVersion } from '../reporting/stream-version.schema.js'
import type {
  FormatClaimShadowingRow,
  FormatRegistryRow,
  FrameworkContributionRow,
  FrameworkModuleRow,
} from '../run-event.schema.js'
import { PrepareError, StageError } from '../Run.schema.js'
import { TemporaryDirectory } from '../Sandbox.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { FrameworkClaimant } from './explain-file-skip.workflow.js'
import { forkCoreSchema, importModule, validateOptions } from './load-config.cell.js'
import type { ValidationSchemaDocument } from './load-config.cell.js'
import { PackageManifestFields } from './package-manifest.schema.js'
import { planPrepare, PrepareDecoded } from './plan-prepare.workflow.js'
import {
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
} from './resolve-configured-plugin.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'
import { selectPackageEntry, SelectPackageEntryCommand } from './select-package-entry.workflow.js'

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly formatRegistry: Format.FormatRegistry
  readonly options: Options.StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: ReporterStage
  readonly frameworkClaimants: readonly FrameworkClaimant[]
}

export interface PrepareExecutorArgs {
  cliOptions: Options.PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

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
  readonly shadowings: readonly {
    readonly kind: PluginKind
    readonly name: string
    readonly shadowedIndex: number
    readonly winnerIndex: number
  }[]
}

const buildPluginLoadPlan = (entries: readonly PluginLoaderEntry[]): PluginLoadPlan => {
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

const loadPlugins = (
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
  })

const pluginUrlsFromOptions = (options: Options.StrykerOptions): readonly string[] => [
  ...options.plugins,
  ...options.appendPlugins,
  ...options.ignorers,
  ...Match.value(options.testRunner).pipe(
    Match.when(Options.isCustomTestRunner, (runner) => [runner.plugin]),
    Match.orElse(() => []),
  ),
  ...options.checkers.map((checker) => checker.plugin),
]

type PrepareRaw = typeof PrepareDecoded.Encoded & {
  readonly env: RunEnvironmentShape
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly options: Options.StrykerOptions
  readonly loaded: LoadedPlugins
  readonly project: Project
  readonly ignorers: readonly Ignorer[]
  readonly formatRegistry: Format.FormatRegistry
  readonly builtinReporterFactories: Record<string, InterfaceReporter.ReporterFactory>
  readonly reporterChoicesByName: HashMap.HashMap<string, ReporterChoice>
  readonly frameworkClaimants: readonly FrameworkClaimant[]
}

const PLUGIN_FAILURE_REMEDIATION: Record<PluginLoadFailureReason['_tag'], string> = {
  PeerMissing: 'install the peer dependency the plugin needs',
  PeerVersionUnsupported: 'install a supported version of the peer dependency',
  PeerUnrecognized: 'install a peer version the plugin recognizes, or a matching plugin version',
  InvalidContribution: 'fix the contribution the plugin declares',
  ImportFailed: 'fix the plugin so that it imports cleanly',
}

const exitCodeOfClass = (exitClass: Plugin.ExitClass): Effect.Effect<number> =>
  Effect.orDie(S.decodeEffect(Plugin.ExitCodeFromClass)(exitClass))

const pluginLoadFailureEvents = (
  error: PluginLoadRefusedError,
  elapsedMs: number,
): Effect.Effect<readonly [PhaseEntered, RunFailed]> =>
  Effect.map(
    exitCodeOfClass(error.exitClass),
    (code): readonly [PhaseEntered, RunFailed] => [
      PhaseEntered.make({ phase: 'prepare', elapsedMs }),
      RunFailed.make({
        schemaVersion: StreamSchemaVersion.literal,
        code,
        error: error.message,
        remediation: PLUGIN_FAILURE_REMEDIATION[error.reason._tag],
        reason: error.reason._tag,
      }),
    ],
  )

type FrameworkContributionModule = LoadedPlugins['frameworks'][number]

const frameworkRowOf = (entry: FrameworkContributionModule): FrameworkContributionRow => ({
  name: entry.framework.name,
  formatId: entry.framework.claim.formatId,
  extensions: [...entry.framework.claim.extensions],
})

interface ModuleRowAccumulator {
  readonly modules: ReadonlyArray<FrameworkModuleRow>
}

const emptyModuleRows = (): ModuleRowAccumulator => ({ modules: [] })

const appendModuleRow = (
  accumulator: ModuleRowAccumulator,
  entry: FrameworkContributionModule,
): ModuleRowAccumulator =>
  Option.match(Option.fromUndefinedOr(accumulator.modules.find((row) => row.moduleName === entry.moduleName)), {
    onNone: () => ({
      modules: [...accumulator.modules, { moduleName: entry.moduleName, contributions: [frameworkRowOf(entry)] }],
    }),
    onSome: (found) => ({
      modules: accumulator.modules.map((row) =>
        row.moduleName === found.moduleName
          ? { moduleName: row.moduleName, contributions: [...row.contributions, frameworkRowOf(entry)] }
          : row
      ),
    }),
  })

const moduleRowsOf = (loaded: LoadedPlugins): readonly FrameworkModuleRow[] =>
  loaded.frameworks.reduce(appendModuleRow, emptyModuleRows()).modules

interface FormatReportRows {
  readonly rows: readonly FormatRegistryRow[]
  readonly shadowings: readonly FormatClaimShadowingRow[]
}

interface FormatReportAccumulator {
  readonly winners: HashMap.HashMap<string, Format.FormatEntry>
  readonly rows: readonly FormatRegistryRow[]
  readonly shadowings: readonly FormatClaimShadowingRow[]
}

const formatReportOf = (registry: Format.FormatRegistry): FormatReportRows => {
  const report = registry.entries
    .flatMap((entry) => entry.claim.extensions.map((extension) => ({ entry, extension })))
    .reduce<FormatReportAccumulator>(
      (accumulator, { entry, extension }) =>
        Option.match(HashMap.get(accumulator.winners, extension), {
          onNone: () => ({
            winners: HashMap.set(accumulator.winners, extension, entry),
            rows: [
              ...accumulator.rows,
              {
                extension,
                formatId: entry.claim.formatId,
                ownerModule: entry.owner,
                language: entry.claim.language,
              },
            ],
            shadowings: accumulator.shadowings,
          }),
          onSome: (winner) => ({
            winners: accumulator.winners,
            rows: accumulator.rows,
            shadowings: [...accumulator.shadowings, { extension, winner: winner.owner, loser: entry.owner }],
          }),
        }),
      { winners: HashMap.empty<string, Format.FormatEntry>(), rows: [], shadowings: [] },
    )
  return { rows: report.rows, shadowings: report.shadowings }
}

const reportPluginLoad = (
  queue: Queue.Queue<RunEvent, Cause.Done>,
  loaded: LoadedPlugins,
  registry: Format.FormatRegistry,
): Effect.Effect<void> =>
  Effect.gen(function*() {
    const report = formatReportOf(registry)
    yield* Queue.offer(
      queue,
      PluginsReported.make({
        modules: [...moduleRowsOf(loaded)],
        shadowings: [...report.shadowings],
      }),
    )
    yield* Queue.offer(
      queue,
      FormatRegistryResolved.make({ rows: [...report.rows] }),
    )
  })

const dependencyNamesOf = (
  dependencies: S.Schema.Type<typeof ProjectDependencies>['dependencies'],
): readonly string[] => Object.keys(dependencies ?? {})

const installedClaimantOf =
  (fs: FileSystem.FileSystem, path: Path.Path, basePath: string) =>
  (name: string): Effect.Effect<Option.Option<FrameworkClaimant>, never> =>
    Effect.gen(function*() {
      const text = yield* fs
        .readFileString(path.join(basePath, 'node_modules', name, 'package.json'))
        .pipe(Effect.orElseSucceed(() => ''))
      return Option.map(
        Option.filter(
          Result.match(S.decodeResult(S.fromJsonString(FrameworkManifestSchema))(text), {
            onFailure: () => Option.none<readonly string[]>(),
            onSuccess: (manifest) => Option.some([...manifest.strykerFramework.extensions]),
          }),
          (extensions) => extensions.length > 0,
        ),
        (extensions): FrameworkClaimant => ({ package: name, extensions }),
      )
    })

const installedFrameworkClaimants = (
  basePath: string,
): Effect.Effect<readonly FrameworkClaimant[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(basePath, 'package.json')).pipe(Effect.orElseSucceed(() => ''))
    const names = yield* Result.match(S.decodeResult(S.fromJsonString(ProjectDependencies))(text), {
      onFailure: () => Effect.succeed<readonly string[]>([]),
      onSuccess: (manifest) =>
        Effect.succeed(
          Array.dedupe([
            ...dependencyNamesOf(manifest.dependencies),
            ...dependencyNamesOf(manifest.devDependencies),
          ]),
        ),
    })
    const found = yield* Effect.forEach(names, installedClaimantOf(fs, path, basePath), {
      concurrency: 'unbounded',
    })
    return Array.getSomes(found)
  })

const schemaPropertiesOf = <A = unknown>(document: ValidationSchemaDocument<A>): Record<string, NonNullable<A>> =>
  Option.getOrElse(Option.fromNullishOr(document.properties), () => ({}))

const buildMergedSchema = <A = unknown>(
  core: ValidationSchemaDocument,
  contributions: readonly Record<string, A>[],
) =>
  Boolean.match(contributions.length === 0, {
    onTrue: () => core,
    onFalse: () => ({
      ...core,
      properties: contributions.reduce(
        (merged, contribution) => ({ ...merged, ...schemaPropertiesOf(contribution) }),
        schemaPropertiesOf(core),
      ),
    }),
  })

interface ReporterChoice {
  readonly name: string
  readonly builtinFactory: Option.Option<InterfaceReporter.ReporterFactory>
}

const announceSummary = (env: RunEnvironmentShape, summary: string) =>
  Match.value(env.resolvedMode.mode).pipe(
    Match.when('human', () => announceHumanSummary(env.allowConsoleColors, summary)),
    Match.orElse(() => Effect.logInfo(summary)),
  )

const announceHumanSummary = (allowConsoleColors: boolean, summary: string) =>
  Boolean.match(allowConsoleColors, {
    onTrue: () => Console.log(`${AnsiCode.fields.green.literal}${summary}${AnsiCode.fields.reset.literal}`),
    onFalse: () => Console.log(summary),
  })

const NO_PLUGIN_DESCRIPTORS: readonly PluginDescriptor[] = []

const spawnPluginReporterFactory = (
  name: string,
  loaded: LoadedPlugins,
  projectBasePath: string,
  options: Options.StrykerOptions,
): Effect.Effect<
  InterfaceReporter.ReporterFactory,
  StageError,
  Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const entry = yield* Effect.mapError(
      Effect.fromResult(
        resolveConfiguredPlugin(
          WorkerSpawnCommand.make({
            sources: loaded.pluginSources,
            kind: 'Reporter',
            configured: ConfiguredPluginName.make({ name }),
          }),
        ),
      ),
      (missing) =>
        StageError.make({
          stage: 'prepare',
          reason: missing.reason,
          cause: PluginNotFoundError.make({ descriptor: missing.descriptor }),
        }),
    )
    const client = yield* spawnReporterWorker({
      entrypoint: entry.entrypoint,
      projectBasePath,
      execArgv: [],
      options,
      tempDirPrefix: 'stryker-reporter-',
    }).pipe(
      Effect.mapError((cause) =>
        StageError.make({ stage: 'prepare', reason: `Failed to start the reporter worker "${name}"`, cause })
      ),
    )
    return reporterWorkerFactory(client)
  })

const reporterInputsOf = (
  names: readonly string[],
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
  loaded: LoadedPlugins,
  projectBasePath: string,
  options: Options.StrykerOptions,
): Effect.Effect<
  readonly AttachReporterInput[],
  StageError,
  Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.forEach(
    selectReporterChoices(names, choicesByName),
    (choice) =>
      Option.match(choice.builtinFactory, {
        onSome: (builtin) => Effect.succeed<AttachReporterInput>({ name: choice.name, factory: builtin }),
        onNone: () =>
          Effect.map(
            spawnPluginReporterFactory(choice.name, loaded, projectBasePath, options),
            (factory): AttachReporterInput => ({ name: choice.name, factory }),
          ),
      }),
    { concurrency: 1 },
  )

const selectReporterChoices = (names: readonly string[], choicesByName: HashMap.HashMap<string, ReporterChoice>) =>
  Array.map(
    Array.reduce(
      names,
      Array.empty<readonly [string, ReporterChoice]>(),
      (chosen, name) =>
        Option.match(HashMap.get(choicesByName, name.toLowerCase()), {
          onNone: () => chosen,
          onSome: (choice) =>
            Option.match(Array.findFirst(chosen, ([key]) => key === name.toLowerCase()), {
              onNone: () => [...chosen, [name.toLowerCase(), choice] as const],
              onSome: () => chosen,
            }),
        }),
    ),
    ([, choice]) => choice,
  )

const readPrepare = (command: ReadProjectDone): Effect.Effect<
  PrepareRaw,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const env = yield* RunEnvironment
    const queue = yield* RunEvents
    const coreSchema: ValidationSchemaDocument = forkCoreSchema
    const configured = command.options
    const resolvedReporters = selectReporters([...configured.reporters], env.resolvedMode.mode)
    const options: Options.StrykerOptions = {
      ...configured,
      reporters: resolvedReporters,
      allowConsoleColors: env.allowConsoleColors,
      clearTextReporter: {
        ...configured.clearTextReporter,
        allowColor: env.allowConsoleColors,
      },
    }
    const descriptors: readonly string[] = pluginUrlsFromOptions(options)
    const loaded = yield* loadPlugins(descriptors, env.basePath).pipe(
      Effect.tapError((error) =>
        Effect.gen(function*() {
          const failedAt = yield* Clock.currentTimeMillis
          const events = yield* pluginLoadFailureEvents(error, failedAt - env.runStartedAt)
          yield* Effect.forEach(events, (event) => Queue.offer(queue, event), { discard: true })
        })
      ),
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to load plugins', cause })),
    )
    const registry = Format.registerEntries(
      Format.coreFormatRegistry,
      loaded.frameworks.map(({ moduleName, framework }) => Format.frameworkEntryOf(moduleName, framework)),
    )
    yield* reportPluginLoad(queue, loaded, registry)
    const mergedSchema = buildMergedSchema(coreSchema, loaded.schemaContributions)
    const record = { ...options }
    yield* validateOptions(record, mergedSchema).pipe(
      Effect.mapError(
        (cause) =>
          StageError.make({
            stage: 'prepare',
            reason: 'Failed to revalidate options with plugin schema',
            cause,
          }),
      ),
    )
    const ignorers: readonly Ignorer[] = loaded.ignorers

    const builtinReporterFactories: Record<string, InterfaceReporter.ReporterFactory> = {
      ...(yield* Reporter).builtin,
      ...env.builtinReporters,
    }
    const pluginReporterDescriptors = Option.getOrElse(
      HashMap.get(loaded.pluginsByKind, 'Reporter'),
      () => NO_PLUGIN_DESCRIPTORS,
    )
    const reporterChoicesByName = HashMap.fromIterable<string, ReporterChoice>([
      ...Object.entries(builtinReporterFactories).map(
        ([name, factory]) => [name.toLowerCase(), { name, builtinFactory: Option.some(factory) }] as const,
      ),
      ...pluginReporterDescriptors.map(
        (descriptor) =>
          [
            descriptor.name.toLowerCase(),
            { name: descriptor.name, builtinFactory: Option.none<InterfaceReporter.ReporterFactory>() },
          ] as const,
      ),
    ])
    const frameworkClaimants = yield* installedFrameworkClaimants(env.basePath)
    return {
      mode: env.resolvedMode.mode,
      reporters: [...options.reporters],
      fileCount: MutableHashMap.size(command.project.files),
      availableReporters: [...HashMap.values(reporterChoicesByName)].map((choice) => choice.name),
      env,
      queue,
      options,
      loaded,
      project: command.project,
      ignorers,
      formatRegistry: registry,
      builtinReporterFactories,
      reporterChoicesByName,
      frameworkClaimants,
    }
  })

const writePrepare = (
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.Effect<PrepareDone, StageError, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  withPhaseSpan(
    'prepare',
    {},
    (span) =>
      Effect.gen(function*() {
        const mutateCount = MutableHashMap.size(raw.project.filesToMutate)
        yield* announceSummary(
          raw.env,
          `Found ${mutateCount} of ${MutableHashMap.size(raw.project.files)} file(s) to be mutated.`,
        )
        yield* validateReporterNames(
          raw.options.reporters,
          [...HashMap.values(raw.reporterChoicesByName)].map((choice) => choice.name),
        ).pipe(
          Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: cause.message, cause })),
        )
        const failOnEmptyProject = (fileCount: number): Effect.Effect<void, StageError> =>
          Match.value(fileCount).pipe(
            Match.when(0, () =>
              Effect.fail(
                StageError.make({
                  stage: 'prepare',
                  reason: 'No input files found.',
                  cause: PrepareError.make({ stage: 'prepare', reason: 'No input files found.' }),
                }),
              )),
            Match.orElse(() => Effect.void),
          )

        yield* failOnEmptyProject(raw.project.files.pipe(MutableHashMap.size))
        const temporaryDirectoryPath = yield* Effect.map(
          Layer.build(TemporaryDirectory.layer(raw.options)),
          (temporaryDirectory) => Context.get(temporaryDirectory, TemporaryDirectory).path,
        ).pipe(
          Effect.mapError((cause) =>
            StageError.make({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
          ),
        )
        const reporterInputs = yield* reporterInputsOf(
          reporters,
          raw.reporterChoicesByName,
          raw.loaded,
          raw.env.basePath,
          raw.options,
        )
        const reporterInit = yield* currentReporterInit(span)
        const reporterStage = yield* attachReporterFactories(reporterInputs, raw.options, reporterInit)
        const now = yield* Clock.currentTimeMillis
        yield* Queue.offer(raw.queue, PhaseEntered.make({ phase: 'prepare', elapsedMs: now - raw.env.runStartedAt }))
        return {
          project: raw.project,
          loadedPlugins: raw.loaded,
          ignorers: raw.ignorers,
          formatRegistry: raw.formatRegistry,
          options: raw.options,
          temporaryDirectoryPath,
          reporterStage,
          frameworkClaimants: raw.frameworkClaimants,
        }
      }),
  )

const STREAM_REPORTER = 'progress-stream'
const HUMAN_REPORTER = 'clear-text'

const STDOUT_REPORTERS: Readonly<Record<string, true>> = { 'clear-text': true, 'progress': true }

const asHumanReporter = (name: string): string => {
  if (name === STREAM_REPORTER) {
    return HUMAN_REPORTER
  }
  return name
}

const selectReporters: {
  (configured: readonly string[], mode: 'human' | 'machine'): readonly string[]
  (mode: 'human' | 'machine'): (configured: readonly string[]) => readonly string[]
} = dual(2, (configured: readonly string[], mode: 'human' | 'machine'): readonly string[] =>
  Match.value(mode).pipe(
    Match.when('human', () => [...new Set(configured.map(asHumanReporter))]),
    Match.when('machine', () => {
      const permitted = configured.filter((name) => STDOUT_REPORTERS[name] !== true)
      return Match.value(permitted.includes(STREAM_REPORTER)).pipe(
        Match.when(true, () => permitted),
        Match.when(false, () => [...permitted, STREAM_REPORTER]),
        Match.exhaustive,
      )
    }),
    Match.exhaustive,
  ))

export const prepareCell: Cell.Cell<
  ReadProjectDone,
  PrepareDone,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> = Sandwich.named('stryker.prepare')(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    MachineReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'prepare', reason: issue })),
  })
