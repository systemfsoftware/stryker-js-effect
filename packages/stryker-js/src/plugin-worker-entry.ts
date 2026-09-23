import type { WorkerPluginKind, WorkerPluginSpawn } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { findByKindAndName, type LoadedPlugins, type WorkerPluginSource } from './Plugins.js'
import { PluginNotFoundError } from './Plugins.schema.js'
import { StageError } from './Run.schema.js'

export const missingWorkerEntry =
  (stage: StageError['stage'], kind: string, name: string) => (failure: PluginNotFoundError): StageError =>
    StageError.make({
      stage,
      reason: `the ${kind} plugin "${name}" is not among the loaded plugins`,
      cause: failure,
    })

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

export const resolveConfiguredWorkerSpawn = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly configured: string | { readonly plugin: string }
}): Effect.Effect<{ readonly name: string; readonly spawn: WorkerPluginSpawn }, PluginNotFoundError> => {
  const byName = (name: string) =>
    requiredSource({ loaded: params.loaded, kind: params.kind, name }).pipe(
      Effect.map((source) => ({
        name,
        spawn: { kind: params.kind, entrypoint: source.workerEntry },
      })),
    )
  if (typeof params.configured === 'string') {
    return byName(params.configured)
  }
  const pluginUrl = params.configured.plugin
  return Effect.fromOption(
    Option.map(
      Option.fromUndefinedOr(
        params.loaded.pluginSources.find(
          (source): source is WorkerPluginSource => source.kind === params.kind && source.modulePath === pluginUrl,
        ),
      ),
      (source) => ({
        name: source.name,
        spawn: { kind: params.kind, entrypoint: source.workerEntry },
      }),
    ),
    () => PluginNotFoundError.make({ descriptor: `${params.kind}:${pluginUrl}` }),
  )
}
