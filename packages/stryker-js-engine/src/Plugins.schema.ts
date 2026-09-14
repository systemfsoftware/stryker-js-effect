/**
 * Plugins capability — declarations for plugin module shapes and load failures.
 */

import { Schema as S } from 'effect'

export const PluginModuleSchema = S.Struct({
  strykerPlugins: S.Array(S.Unknown),
})

const isShouldIgnore = (value: unknown): value is (path: unknown) => string | undefined => typeof value === 'function'

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function'

const StandardSchemaPropsSchema = S.Struct({
  version: S.Literal(1),
  vendor: S.String,
  validate: S.declare(isFunction),
})
const StandardSchemaShapeSchema = S.Struct({ '~standard': StandardSchemaPropsSchema })

export const PlainIgnorerSchema = S.Struct({
  name: S.String,
  schema: StandardSchemaShapeSchema,
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
