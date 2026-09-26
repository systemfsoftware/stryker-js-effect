import * as S from 'effect/Schema'

export class ConfigFileNotFoundError extends S.TaggedError<ConfigFileNotFoundError>()(
  'ConfigFileNotFoundError',
  {
    file: S.String,
  },
) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `Config file not found: ${this.file}`
  }
}

export class ConfigFileUnsupportedError extends S.TaggedError<ConfigFileUnsupportedError>()(
  'ConfigFileUnsupportedError',
  {
    file: S.String,
    hint: S.String,
  },
) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return this.hint
  }
}

export class ConfigFileUnreadableError extends S.TaggedError<ConfigFileUnreadableError>()(
  'ConfigFileUnreadableError',
  {
    file: S.String,
    cause: S.Unknown,
  },
) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `Config file is unreadable: ${this.file}`
  }
}

export class ConfigFileInvalidError extends S.TaggedError<ConfigFileInvalidError>()(
  'ConfigFileInvalidError',
  {
    file: S.String,
    cause: S.Unknown,
  },
) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `Invalid config file: ${this.file}`
  }
}

export class ConfigFactoryFailed extends S.TaggedError<ConfigFactoryFailed>()('ConfigFactoryFailed', {
  message: S.String,
  cause: S.Defect(),
}) {
  readonly exitClass = 'ConfigError' as const
}

export class ConfigModuleUnloadable extends S.TaggedError<ConfigModuleUnloadable>()('ConfigModuleUnloadable', {
  message: S.String,
  code: S.String,
  file: S.String,
  cause: S.Defect(),
}) {
  readonly exitClass = 'ConfigError' as const
}

export class ConfigError extends S.TaggedError<ConfigError>()('ConfigError', {
  message: S.String,
}) {
  readonly exitClass = 'ConfigError' as const
}

export type ConfigReadError =
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError
  | ConfigError
