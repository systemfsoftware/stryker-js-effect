import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import * as Array from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'

import type { LoadedPlugins } from './Plugins.schema.js'

export const pluginLoadPhaseEvent = (elapsedMs: number): RunEvent.PhaseEntered =>
  RunEvent.PhaseEntered.make({ phase: 'prepare', elapsedMs })

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
  Effect.fn(SpanTaxonomy.Spans.pluginLoadReport.name)(
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
