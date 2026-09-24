import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

import type { LoadedPlugins } from './Plugins.schema.js'
import { type PluginLoadFailureReason, type PluginLoadRefusedError } from './PluginsError.schema.js'
import { StreamSchemaVersion } from './reporting/stream-version.schema.js'
import type {
  FormatClaimShadowingRow,
  FormatRegistryRow,
  FrameworkContributionRow,
  FrameworkModuleRow,
} from './run-event.schema.js'
import { type RunEvent } from './run-events.service.js'
import { FormatRegistryResolved, PhaseEntered, PluginsReported, RunFailed } from './run-events.service.js'

const PLUGIN_FAILURE_REMEDIATION: Record<PluginLoadFailureReason['_tag'], string> = {
  PeerMissing: 'install the peer dependency the plugin needs',
  PeerVersionUnsupported: 'install a supported version of the peer dependency',
  PeerUnrecognized: 'install a peer version the plugin recognizes, or a matching plugin version',
  InvalidContribution: 'fix the contribution the plugin declares',
  ImportFailed: 'fix the plugin so that it imports cleanly',
}

const exitCodeOfClass = (exitClass: Plugin.ExitClass): Effect.Effect<number> =>
  Effect.orDie(S.decodeEffect(Plugin.ExitCodeFromClass)(exitClass))

export const pluginLoadFailureEvents: {
  (elapsedMs: number): (error: PluginLoadRefusedError) => Effect.Effect<readonly [PhaseEntered, RunFailed]>
  (error: PluginLoadRefusedError, elapsedMs: number): Effect.Effect<readonly [PhaseEntered, RunFailed]>
} = dual(
  2,
  (error: PluginLoadRefusedError, elapsedMs: number): Effect.Effect<readonly [PhaseEntered, RunFailed]> =>
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
    ),
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

export const reportPluginLoad: {
  (
    loaded: LoadedPlugins,
    registry: Format.FormatRegistry,
  ): (queue: Queue.Queue<RunEvent, Cause.Done>) => Effect.Effect<void>
  (
    queue: Queue.Queue<RunEvent, Cause.Done>,
    loaded: LoadedPlugins,
    registry: Format.FormatRegistry,
  ): Effect.Effect<void>
} = dual(
  3,
  (
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
    }),
)
