import type { Options, Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Scope from 'effect/Scope'

import type { LoadedPlugins } from './Plugins.schema.js'
import { PluginNotFoundError } from './PluginsError.schema.js'
import { type AttachReporterInput, reporterWorkerFactory, spawnReporterWorker } from './reporter-stream.service.js'
import { StageError } from './Run.schema.js'
import {
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
} from './run/resolve-configured-plugin.workflow.js'
import { WorkerLauncher } from './WorkerLauncher.service.js'

export interface ReporterChoice {
  readonly name: string
  readonly builtinFactory: Option.Option<InterfaceReporter.ReporterFactory>
}

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

export const reporterInputsOf: {
  (
    choicesByName: HashMap.HashMap<string, ReporterChoice>,
    loaded: LoadedPlugins,
    projectBasePath: string,
    options: Options.StrykerOptions,
  ): (
    names: readonly string[],
  ) => Effect.Effect<
    readonly AttachReporterInput[],
    StageError,
    Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
  >
  (
    names: readonly string[],
    choicesByName: HashMap.HashMap<string, ReporterChoice>,
    loaded: LoadedPlugins,
    projectBasePath: string,
    options: Options.StrykerOptions,
  ): Effect.Effect<
    readonly AttachReporterInput[],
    StageError,
    Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path
  >
} = dual(
  5,
  (
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
    ),
)
