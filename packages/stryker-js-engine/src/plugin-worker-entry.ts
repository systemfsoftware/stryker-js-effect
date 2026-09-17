import type { WorkerPluginKind, WorkerPluginSpawn } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import { findByKindAndName, type LoadedPlugins, type WorkerPluginSource } from './Plugins.js'
import { PluginNotFoundError } from './Plugins.schema.js'
const requiredSource = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly name: string
}): Effect.Effect<WorkerPluginSource, PluginNotFoundError> =>
  Effect.fromOption(
    findByKindAndName(params.loaded.pluginSources, params.kind, params.name),
    () => PluginNotFoundError.make({ descriptor: `${params.kind}:${params.name}` }),
  )

export const resolvePluginWorkerEntry = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly name: string
}): Effect.Effect<WorkerPluginSpawn, PluginNotFoundError> =>
  requiredSource(params).pipe(Effect.map((source) => ({ kind: params.kind, entrypoint: source.workerEntry })))
