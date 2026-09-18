/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { Schema as S } from 'effect'

import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import { WorkerEntryUrl, WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'

export const PluginDescriptorSchema = S.Union([
  S.Struct({ kind: WorkerPluginKind, name: S.String, workerEntry: WorkerEntryUrl }),
  S.Struct({ kind: S.Literals(['Evaluator']), name: S.String }),
])

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(PluginDescriptorSchema),
})

type ShouldIgnore = (node: Node, ancestors: readonly Node[]) => string | undefined

const isShouldIgnore = (value: unknown): value is ShouldIgnore => typeof value === 'function'

const ignoreNothing: ShouldIgnore = () => undefined

export const IgnorerEntrySchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare<ShouldIgnore>(isShouldIgnore, { toArbitrary: () => (fc) => fc.constant(ignoreNothing) }),
})

export const IgnorerModuleSchema = S.Struct({
  strykerIgnorers: S.Array(IgnorerEntrySchema),
})

export const SchemaValidationContributionSchema = S.Struct({
  strykerValidationSchema: S.Record(S.String, S.Unknown),
})

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()(
  'PluginNotFoundError',
  {
    descriptor: S.String,
  },
) {
  readonly exitClass = 'ConfigError' as const
}

export class PluginLoadFailedError extends S.TaggedError<PluginLoadFailedError>()(
  'PluginLoadFailedError',
  {
    descriptor: S.String,
    cause: S.Unknown,
  },
) {
  readonly exitClass = 'InternalError' as const
}
