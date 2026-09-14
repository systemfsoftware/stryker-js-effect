/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { PluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import type { PluginContribution } from '@systemfsoftware/stryker-js-plugin-interface'
import { Schema as S } from 'effect'
import * as SSchema from 'effect/Schema'

const isPluginContribution = (_value: unknown): _value is PluginContribution<PluginKind> => true
const PluginContributionSchema = SSchema.Unknown.pipe(SSchema.refine(isPluginContribution))

export class PluginLoaderEntry extends SSchema.Class<PluginLoaderEntry>('PluginLoaderEntry')({
  moduleName: SSchema.String,
  plugins: SSchema.optional(SSchema.Array(PluginContributionSchema)),
  schemaContribution: SSchema.optional(SSchema.Record(SSchema.String, SSchema.Unknown)),
}) {}

export class LoadPluginsCommand extends SSchema.Class<LoadPluginsCommand>('LoadPluginsCommand')({
  entries: SSchema.Array(PluginLoaderEntry),
}) {}

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(S.Unknown),
})

const isShouldIgnore = (value: unknown): value is (path: unknown) => string | undefined => typeof value === 'function'

export const PlainIgnorerSchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare(isShouldIgnore),
})

export const SchemaValidationContributionSchema = S.Struct({
  strykerValidationSchema: S.Record(S.String, S.Unknown),
})
export const PlainIgnorerModuleSchema = S.Struct({
  strykerIgnorers: S.Array(PlainIgnorerSchema),
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
