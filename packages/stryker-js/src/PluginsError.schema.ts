import { Schema as S } from 'effect'

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()('PluginNotFoundError', {
  descriptor: S.String,
}) {
  readonly exitClass = 'ConfigError' as const
}

export class PluginLoadFailedError extends S.TaggedError<PluginLoadFailedError>()('PluginLoadFailedError', {
  descriptor: S.String,
  cause: S.Defect(),
}) {
  readonly exitClass = 'InternalError' as const
}
