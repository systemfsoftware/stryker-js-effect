import { Workflow } from '@systemfsoftware/effect-cell-types'
import { WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type PluginSource, PluginSourceSchema, type WorkerPluginSource } from '../Plugins.schema.js'

const ResolvedWorkerSpawnTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ResolvedWorkerSpawn')
type ResolvedWorkerSpawnTypeId = typeof ResolvedWorkerSpawnTypeId

export class ConfiguredPluginName extends S.TaggedClass<ConfiguredPluginName>()('ConfiguredPluginName', {
  name: S.String,
}) {}

export class ConfiguredPluginModulePath
  extends S.TaggedClass<ConfiguredPluginModulePath>()('ConfiguredPluginModulePath', {
    modulePath: S.String,
  })
{}

export const ConfiguredPluginSchema = S.Union([ConfiguredPluginName, ConfiguredPluginModulePath])

export class WorkerSpawnResolved extends S.TaggedClass<WorkerSpawnResolved>()('WorkerSpawnResolved', {
  kind: WorkerPluginKind,
  name: S.String,
  entrypoint: S.String,
}) {
  readonly [ResolvedWorkerSpawnTypeId] = ResolvedWorkerSpawnTypeId
}

export class WorkerSpawnMissing extends S.TaggedError<WorkerSpawnMissing>()('WorkerSpawnMissing', {
  reason: S.String,
  descriptor: S.String,
}) {}

export class WorkerSpawnCommand extends S.TaggedClass<WorkerSpawnCommand>()('WorkerSpawnCommand', {
  sources: S.Array(PluginSourceSchema),
  kind: WorkerPluginKind,
  configured: ConfiguredPluginSchema,
}) {
  static readonly [Workflow.InstrumentationBrand] = { kind: 'stryker.plugin.kind' } as const
}

const labelOfKind = (kind: WorkerPluginKind) =>
  Match.value(kind).pipe(
    Match.when('TestRunner', () => 'test runner'),
    Match.when('Checker', () => 'checker'),
    Match.when('Reporter', () => 'reporter'),
    Match.exhaustive,
  )

const kindIs = (kind: WorkerPluginKind) => (source: PluginSource): source is WorkerPluginSource =>
  Match.value(source.kind).pipe(
    Match.when(kind, () => true),
    Match.orElse(() => false),
  )

const workerSourceOf = (
  sources: readonly PluginSource[],
  kind: WorkerPluginKind,
  matches: (worker: WorkerPluginSource) => boolean,
): Option.Option<WorkerPluginSource> => Array.findFirst(Array.filter(sources, kindIs(kind)), matches)

const resolvedSpawnOf = (
  command: WorkerSpawnCommand,
  matches: (worker: WorkerPluginSource) => boolean,
  label: string,
): Result.Result<WorkerSpawnResolved, WorkerSpawnMissing> =>
  Option.match(workerSourceOf(command.sources, command.kind, matches), {
    onSome: (worker) =>
      Result.succeed(
        WorkerSpawnResolved.make({ kind: command.kind, name: worker.name, entrypoint: worker.workerEntry }),
      ),
    onNone: () => {
      const kindLabel = labelOfKind(command.kind)
      return Result.fail(
        WorkerSpawnMissing.make({
          reason: `the ${kindLabel} plugin "${label}" is not among the loaded plugins`,
          descriptor: `${command.kind}:${label}`,
        }),
      )
    },
  })

const decide = (command: WorkerSpawnCommand): Result.Result<WorkerSpawnResolved, WorkerSpawnMissing> =>
  Match.value(command.configured).pipe(
    Match.tag('ConfiguredPluginName', (configured) =>
      resolvedSpawnOf(
        command,
        (worker) => worker.name.toLowerCase() === configured.name.toLowerCase(),
        configured.name,
      )),
    Match.tag('ConfiguredPluginModulePath', (configured) =>
      resolvedSpawnOf(command, (worker) => worker.modulePath === configured.modulePath, configured.modulePath)),
    Match.exhaustive,
  )

export const resolveConfiguredPlugin = Workflow.make({
  command: WorkerSpawnCommand,
  decision: WorkerSpawnResolved,
  error: WorkerSpawnMissing,
  decide,
})
