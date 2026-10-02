import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import * as S from 'effect/Schema'

export class ConfigFileNotFoundError extends S.TaggedError<ConfigFileNotFoundError>()(
  'ConfigFileNotFoundError',
  {
    file: S.String,
  },
) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }

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
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }

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
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }

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
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }

  override get message(): string {
    return `Invalid config file: ${this.file}`
  }
}

export class ConfigFactoryFailed extends S.TaggedError<ConfigFactoryFailed>()('ConfigFactoryFailed', {
  message: S.String,
  cause: S.Defect(),
}) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }
}

export class ConfigModuleUnloadable extends S.TaggedError<ConfigModuleUnloadable>()('ConfigModuleUnloadable', {
  message: S.String,
  code: S.String,
  file: S.String,
  cause: S.Defect(),
}) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }
}

export class ConfigError extends S.TaggedError<ConfigError>()('ConfigError', {
  message: S.String,
}) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'ConfigInvalid', stage: 'config', detail: this.message }
  }
}

export type ConfigReadError =
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError
  | ConfigError
