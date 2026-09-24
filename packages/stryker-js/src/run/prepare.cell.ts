import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import {
  coreFormatRegistry,
  type FormatEntry,
  type FormatRegistry,
  frameworkEntryOf,
  registerEntries,
} from '@systemfsoftware/stryker-js-instrumenter'
import * as Array from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import { type RunEvent } from '../RunEvents.js'
import { FormatRegistryResolved, PhaseEntered, PluginsReported, RunFailed } from '../RunEvents.js'
import { RunEvents } from '../RunEvents.js'
import { type FrameworkClaimant } from './explain-file-skip.workflow.js'

import type {
  PartialStrykerOptions,
  ReporterFactory,
  StrykerOptions,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { makeBuiltinReporterFactories } from '../builtin-reporters.js'
import { EXIT_CODE } from '../exit-classification.js'
import { missingWorkerEntry, resolvePluginWorkerEntry } from '../plugin-worker-entry.js'
import { loadPlugins, pluginUrlsFromOptions } from '../Plugins.js'
import type { LoadedPlugins, PluginDescriptor } from '../Plugins.js'
import {
  FrameworkManifestSchema,
  type PluginLoadFailureReason,
  PluginLoadRefusedError,
  ProjectDependencies,
} from '../Plugins.schema.js'
import { readProject } from '../Project.js'
import type { Project } from '../Project.js'
import { ansi } from '../Reporter.ansi.js'
import {
  attachReporterFactories,
  type AttachReporterInput,
  currentReporterInit,
  type ReporterStage,
  reporterWorkerFactory,
  spawnReporterWorker,
  validateReporterNames,
  withPhaseSpan,
} from '../ReporterStream.js'
import { PrepareError, StageError } from '../Run.schema.js'
import type {
  FormatClaimShadowingRow,
  FormatRegistryRow,
  FrameworkContributionRow,
  FrameworkModuleRow,
} from '../RunEvent.schema.js'
import { TemporaryDirectory, TemporaryDirectoryLive } from '../Sandbox.js'
import { selectReporters } from '../select-reporters.js'
import { STREAM_SCHEMA_VERSION } from '../StreamVersion.js'
import { WorkerLauncher } from '../WorkerLauncher.js'
import { forkCoreSchema, readConfig, validateOptions } from './load-config.cell.js'
import type { ValidationSchemaDocument } from './load-config.cell.js'
import { planPrepare, type PrepareDecision, PrepareDecoded } from './plan-prepare.workflow.js'
import { RunEnvironment } from './RunEnvironment.js'
import type { RunEnvironmentShape } from './RunEnvironment.js'

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly formatRegistry: FormatRegistry
  readonly options: StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: ReporterStage
  readonly frameworkClaimants: readonly FrameworkClaimant[]
}

export interface PrepareExecutorArgs {
  cliOptions: PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

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

interface PrepareRaw {
  readonly frameworkClaimants: readonly FrameworkClaimant[]
  readonly env: RunEnvironmentShape
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly options: StrykerOptions
  readonly loaded: LoadedPlugins
  readonly project: Project
  readonly ignorers: readonly Ignorer[]
  readonly formatRegistry: FormatRegistry
  readonly builtinReporterFactories: Record<string, ReporterFactory>
  readonly reporterChoicesByName: HashMap.HashMap<string, ReporterChoice>
}

const PLUGIN_FAILURE_REMEDIATION: Record<PluginLoadFailureReason['_tag'], string> = {
  PeerMissing: 'install the peer dependency the plugin needs',
  PeerVersionUnsupported: 'install a supported version of the peer dependency',
  PeerUnrecognized: 'install a peer version the plugin recognizes, or a matching plugin version',
  InvalidContribution: 'fix the contribution the plugin declares',
  ImportFailed: 'fix the plugin so that it imports cleanly',
}

const pluginLoadFailureEvents = (
  error: PluginLoadRefusedError,
  elapsedMs: number,
): readonly [PhaseEntered, RunFailed] => [
  PhaseEntered.make({ phase: 'prepare', elapsedMs }),
  RunFailed.make({
    schemaVersion: STREAM_SCHEMA_VERSION,
    code: EXIT_CODE[error.exitClass],
    error: error.message,
    remediation: PLUGIN_FAILURE_REMEDIATION[error.reason._tag],
    reason: error.reason._tag,
  }),
]

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

const formatReportOf = (registry: FormatRegistry): FormatReportRows => {
  const winners = new Map<string, FormatEntry>()
  const rows: FormatRegistryRow[] = []
  const shadowings: FormatClaimShadowingRow[] = []
  registry.entries.forEach((entry) =>
    entry.claim.extensions.forEach((extension) => {
      const winner = winners.get(extension)
      if (winner !== undefined) {
        shadowings.push({ extension, winner: winner.owner, loser: entry.owner })
        return
      }
      winners.set(extension, entry)
      rows.push({
        extension,
        formatId: entry.claim.formatId,
        ownerModule: entry.owner,
        language: entry.claim.language,
      })
    })
  )
  return { rows, shadowings }
}

const reportPluginLoad = (
  queue: Queue.Queue<RunEvent, Cause.Done>,
  loaded: LoadedPlugins,
  registry: FormatRegistry,
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

const schemaPropertiesOf = <A = unknown>(document: ValidationSchemaDocument<A>): Record<string, NonNullable<A>> =>
  Option.getOrElse(Option.fromNullishOr(document.properties), () => ({}))

const buildMergedSchema = <A = unknown>(
  core: ValidationSchemaDocument,
  contributions: readonly Record<string, A>[],
): ValidationSchemaDocument =>
  Match.value(contributions.length === 0).pipe(
    Match.when(true, (): ValidationSchemaDocument => core),
    Match.orElse((): ValidationSchemaDocument => ({
      ...core,
      properties: Object.assign(
        {},
        schemaPropertiesOf(core),
        ...contributions.map((contribution) => schemaPropertiesOf(contribution)),
      ),
    })),
  )

interface ReporterChoice {
  readonly name: string
  readonly builtinFactory: Option.Option<ReporterFactory>
}

const announceSummary = (env: RunEnvironmentShape, summary: string): Effect.Effect<void> =>
  Match.value(env.resolvedMode.mode).pipe(
    Match.when('human', () => announceHumanSummary(env.allowConsoleColors, summary)),
    Match.orElse(() => Effect.logInfo(summary)),
  )

const announceHumanSummary = (allowConsoleColors: boolean, summary: string): Effect.Effect<void> =>
  Match.value(allowConsoleColors).pipe(
    Match.when(true, () => Console.log(ansi.green(summary))),
    Match.orElse(() => Console.log(summary)),
  )

const NO_PLUGIN_DESCRIPTORS: readonly PluginDescriptor[] = []

const spawnPluginReporterFactory = (
  name: string,
  loaded: LoadedPlugins,
  projectBasePath: string,
  options: StrykerOptions,
): Effect.Effect<
  ReporterFactory,
  StageError,
  Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const entry = yield* resolvePluginWorkerEntry({ loaded, kind: 'Reporter', name }).pipe(
      Effect.mapError(missingWorkerEntry('prepare', 'reporter', name)),
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
  options: StrykerOptions,
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

const selectReporter = (
  chosen: Map<string, ReporterChoice>,
  name: string,
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
): void => {
  const key = name.toLowerCase()
  Option.match(HashMap.get(choicesByName, key), {
    onNone: () => undefined,
    onSome: (choice) => {
      if (!chosen.has(key)) {
        chosen.set(key, choice)
      }
    },
  })
}

const selectReporterChoices = (
  names: readonly string[],
  choicesByName: HashMap.HashMap<string, ReporterChoice>,
): readonly ReporterChoice[] => {
  const chosen = new Map<string, ReporterChoice>()
  names.forEach((name) => selectReporter(chosen, name, choicesByName))
  return [...chosen.values()]
}

const readPrepare = (command: PrepareExecutorArgs): Effect.Effect<
  PrepareRaw,
  StageError,
  | Scope.Scope
  | RunEnvironment
  | RunEvents
  | WorkerLauncher
  | FileSystem.FileSystem
  | Path.Path
  | Stdio.Stdio
> =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const env = yield* RunEnvironment
    const queue = yield* RunEvents
    const coreSchema: ValidationSchemaDocument = forkCoreSchema
    const configured = yield* readConfig(command.cliOptions, { command: 'run', mode: env.resolvedMode.mode }).pipe(
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to read config', cause })),
      Effect.tapCause(() =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          yield* Queue.offer(queue, PhaseEntered.make({ phase: 'prepare', elapsedMs: now - env.runStartedAt }))
        }).pipe(Effect.ignore)
      ),
    )
    const resolvedReporters = selectReporters([...configured.reporters], env.resolvedMode.mode)
    const options: StrykerOptions = {
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
          yield* Effect.forEach(
            pluginLoadFailureEvents(error, failedAt - env.runStartedAt),
            (event) => Queue.offer(queue, event),
            { discard: true },
          )
        })
      ),
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to load plugins', cause })),
    )
    const registry = registerEntries(
      coreFormatRegistry,
      loaded.frameworks.map(({ moduleName, framework }) => frameworkEntryOf(moduleName, framework)),
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
    const project = yield* readProject(options, command.targetMutatePatterns, env.basePath).pipe(
      Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause })),
    )
    const ignorers: readonly Ignorer[] = loaded.ignorers

    const builtinReporterFactories: Record<string, ReporterFactory> = {
      ...makeBuiltinReporterFactories({
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
        stdio: yield* Stdio.Stdio,
      }),
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
            { name: descriptor.name, builtinFactory: Option.none<ReporterFactory>() },
          ] as const,
      ),
    ])
    const frameworkClaimants = yield* installedFrameworkClaimants(env.basePath)
    return {
      env,
      queue,
      options,
      loaded,
      project,
      ignorers,
      formatRegistry: registry,
      builtinReporterFactories,
      reporterChoicesByName,
      frameworkClaimants,
    }
  })

const decodePrepare = (raw: PrepareRaw): Result.Result<PrepareDecoded, StageError> =>
  Result.succeed(
    PrepareDecoded.make({
      mode: raw.env.resolvedMode.mode,
      reporters: [...raw.options.reporters],
      fileCount: MutableHashMap.size(raw.project.files),
      availableReporters: [...HashMap.values(raw.reporterChoicesByName)].map((choice) => choice.name),
    }),
  )

const encodePrepareDecision = (
  outcome: Result.Result<PrepareDecision, StageError>,
): Result.Result<PrepareDecision, StageError> => outcome

const writePrepare = (
  outcome: Result.Result<PrepareDecision, StageError>,
  raw: PrepareRaw,
): Effect.Effect<PrepareDone, StageError, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  withPhaseSpan(
    'prepare',
    {},
    (span) =>
      Effect.gen(function*() {
        const decision = yield* Effect.fromResult(outcome)
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
        yield* Match.value(MutableHashMap.size(raw.project.files)).pipe(
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
        const temporaryDirectoryPath = yield* Effect.gen(function*() {
          const live = TemporaryDirectoryLive(raw.options)
          const service = yield* Effect.service(TemporaryDirectory).pipe(Effect.provide(live))
          return service.path
        }).pipe(
          Effect.mapError((cause) =>
            StageError.make({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
          ),
        )
        const reporterInputs = yield* reporterInputsOf(
          Option.getOrElse(
            Match.value(decision).pipe(
              Match.tag('HumanReporters', (human) => Option.some(human.reporters)),
              Match.tag('MachineReporters', (machine) => Option.some(machine.reporters)),
              Match.exhaustive,
            ),
            () => raw.options.reporters,
          ),
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

export const prepareCell: Cell.Cell<
  PrepareExecutorArgs,
  PrepareDone,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Stdio.Stdio
> = Sandwich.read(readPrepare)
  .decode(Sandwich.pure(decodePrepare))
  .decide(planPrepare)
  .encode(Sandwich.pure((outcome) => Result.succeed(encodePrepareDecision(outcome))))
  .write(writePrepare)
