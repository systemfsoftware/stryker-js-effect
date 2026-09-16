/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { Schema as S } from 'effect'

import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import { WorkerPluginKind } from '@systemfsoftware/stryker-js-plugin-interface'

const PluginKindSchema = S.Union([WorkerPluginKind, S.Literals(['Evaluator'])])

export const PluginDescriptorSchema = S.Struct({
  kind: PluginKindSchema,
  name: S.String,
})

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(PluginDescriptorSchema),
})

const isShouldIgnore = (value: unknown): value is (node: Node, ancestors: readonly Node[]) => string | undefined =>
  typeof value === 'function'

export const IgnorerEntrySchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare(isShouldIgnore),
})

export const SchemaValidationContributionSchema = S.Struct({
  strykerValidationSchema: S.Record(S.String, S.Unknown),
})
export const IgnorerModuleSchema = S.Struct({
  strykerIgnorers: S.Array(IgnorerEntrySchema),
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
