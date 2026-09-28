import { Schema as S } from 'effect'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()('PluginNotFoundError', {
  descriptor: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `Plugin "${this.descriptor}" was not found`
  }
}

export const PeerFailureTag = S.Literals(['PeerMissing', 'PeerVersionUnsupported', 'PeerUnrecognized'])
export type PeerFailureTag = typeof PeerFailureTag.Type

const FAILURE_EXIT_CLASS: Record<RunEvent.PluginLoadFailureReason['_tag'], Plugin.ExitClass> = {
  PeerMissing: 'ConfigError',
  PeerVersionUnsupported: 'ConfigError',
  PeerUnrecognized: 'ConfigError',
  InvalidContribution: 'ConfigError',
  ImportFailed: 'InternalError',
}

export class PluginLoadRefusedError extends S.TaggedError<PluginLoadRefusedError>()(
  'PluginLoadRefusedError',
  {
    descriptor: S.String,
    reason: RunEvent.PluginLoadFailureReason,
  },
) {
  get exitClass(): Plugin.ExitClass {
    return FAILURE_EXIT_CLASS[this.reason._tag]
  }

  override get message(): string {
    return `Failed to load plugin "${this.descriptor}" (${this.reason._tag})`
  }
}
