import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

import type { LoadedPlugins } from './Plugins.schema.js'
import { type PluginLoadRefusedError } from './PluginsError.schema.js'

const PLUGIN_FAILURE_REMEDIATION: Record<RunEvent.PluginLoadFailureReason['_tag'], string> = {
  PeerMissing: 'install the peer dependency the plugin needs',
  PeerVersionUnsupported: 'install a supported version of the peer dependency',
  PeerUnrecognized: 'install a peer version the plugin recognizes, or a matching plugin version',
  InvalidContribution: 'fix the contribution the plugin declares',
  ImportFailed: 'fix the plugin so that it imports cleanly',
}

const exitCodeOfClass = (exitClass: Plugin.ExitClass): Effect.Effect<number> =>
  Effect.orDie(S.decodeEffect(Plugin.ExitCodeFromClass)(exitClass))

export const pluginLoadFailureEvents: {
  (
    elapsedMs: number,
  ): (error: PluginLoadRefusedError) => Effect.Effect<readonly [RunEvent.PhaseEntered, RunEvent.RunFailed]>
  (
    error: PluginLoadRefusedError,
    elapsedMs: number,
  ): Effect.Effect<readonly [RunEvent.PhaseEntered, RunEvent.RunFailed]>
} = dual(
  2,
  (
    error: PluginLoadRefusedError,
    elapsedMs: number,
  ): Effect.Effect<readonly [RunEvent.PhaseEntered, RunEvent.RunFailed]> =>
    Effect.map(
      exitCodeOfClass(error.exitClass),
      (code): readonly [RunEvent.PhaseEntered, RunEvent.RunFailed] => [
        RunEvent.PhaseEntered.make({ phase: 'prepare', elapsedMs }),
        RunEvent.RunFailed.make({
          schemaVersion: RunEvent.StreamSchemaVersion.literal,
          code,
          error: error.message,
          remediation: PLUGIN_FAILURE_REMEDIATION[error.reason._tag],
          reason: error.reason,
        }),
      ],
    ),
)

type FrameworkContributionModule = LoadedPlugins['frameworks'][number]

const frameworkRowOf = (entry: FrameworkContributionModule): RunEvent.FrameworkContributionRow => ({
  name: entry.framework.name,
  formatId: entry.framework.claim.formatId,
  extensions: [...entry.framework.claim.extensions],
})

const moduleRowsOf = (loaded: LoadedPlugins): readonly RunEvent.FrameworkModuleRow[] =>
  Object.entries(Array.groupBy(loaded.frameworks, (entry) => entry.moduleName)).map(
    ([moduleName, entries]) => ({ moduleName, contributions: entries.map(frameworkRowOf) }),
  )

interface FormatReportRows {
  readonly rows: readonly RunEvent.FormatRegistryRow[]
  readonly shadowings: readonly RunEvent.FormatClaimShadowingRow[]
}

const formatReportOf = (registry: Format.FormatRegistry): FormatReportRows => {
  const winners = MutableHashMap.empty<string, Format.FormatEntry>()
  const rows: RunEvent.FormatRegistryRow[] = []
  const shadowings: RunEvent.FormatClaimShadowingRow[] = []
  registry.entries
    .flatMap((entry) => entry.claim.extensions.map((extension) => ({ entry, extension })))
    .forEach(({ entry, extension }) => {
      Option.match(MutableHashMap.get(winners, extension), {
        onNone: () => {
          MutableHashMap.set(winners, extension, entry)
          rows.push({
            extension,
            formatId: entry.claim.formatId,
            ownerModule: entry.owner,
            language: entry.claim.language,
          })
        },
        onSome: (winner) => {
          shadowings.push({ extension, winner: winner.owner, loser: entry.owner })
        },
      })
    })
  return { rows, shadowings }
}

export const reportPluginLoad: {
  (
    loaded: LoadedPlugins,
    registry: Format.FormatRegistry,
  ): (queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>) => Effect.Effect<void>
  (
    queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
    loaded: LoadedPlugins,
    registry: Format.FormatRegistry,
  ): Effect.Effect<void>
} = dual(
  3,
  Effect.fn('stryker.pluginLoad.report')(
    function*(
      queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
      loaded: LoadedPlugins,
      registry: Format.FormatRegistry,
    ): Effect.fn.Return<void> {
      const report = formatReportOf(registry)
      yield* Queue.offer(
        queue,
        RunEvent.PluginsReported.make({
          modules: [...moduleRowsOf(loaded)],
          shadowings: [...report.shadowings],
        }),
      )
      yield* Queue.offer(
        queue,
        RunEvent.FormatRegistryResolved.make({ rows: [...report.rows] }),
      )
    },
  ),
)
