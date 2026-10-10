import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

const CAUSE_DEPTH = 4

const ownMessageOf = <A>(value: A): Option.Option<string> =>
  Option.filter(
    Option.map(Option.liftPredicate(value, Predicate.hasProperty('message')), (carrier) => String(carrier.message)),
    S.is(S.NonEmptyString),
  )

const causeMessagesOf = <A>(value: A, depth: number): ReadonlyArray<string> =>
  depth === 0 ? [] : [
    ...Option.toArray(ownMessageOf(value)),
    ...Option.match(Option.liftPredicate(value, Predicate.hasProperty('cause')), {
      onNone: () => [],
      onSome: (carrier) => causeMessagesOf(carrier.cause, depth - 1),
    }),
  ]

const causeTextOf = <A>(cause: A): Option.Option<string> =>
  Option.liftPredicate(causeMessagesOf(cause, CAUSE_DEPTH).join(': '), S.is(S.NonEmptyString))

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
    return Option.match(causeTextOf(this.cause), {
      onNone: () => `Config file is unreadable: ${this.file}`,
      onSome: (cause) => `Config file is unreadable: ${this.file}: ${cause}`,
    })
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
