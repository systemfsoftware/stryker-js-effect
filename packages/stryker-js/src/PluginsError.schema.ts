import { Schema as S } from 'effect'

import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()('PluginNotFoundError', {
  descriptor: S.String,
}) {
  readonly exitClass = 'ConfigError' as const
}

export const PluginLoadFailureReason = S.Union([
  S.TaggedStruct('PeerMissing', { peer: S.String }),
  S.TaggedStruct('PeerVersionUnsupported', { peer: S.String, detail: S.String }),
  S.TaggedStruct('PeerUnrecognized', { peer: S.String }),
  S.TaggedStruct('InvalidContribution', { detail: S.String }),
  S.TaggedStruct('ImportFailed', { cause: S.Unknown }),
])
export type PluginLoadFailureReason = typeof PluginLoadFailureReason.Type

export const PeerFailureTag = S.Literals(['PeerMissing', 'PeerVersionUnsupported', 'PeerUnrecognized'])
export type PeerFailureTag = typeof PeerFailureTag.Type

const FAILURE_EXIT_CLASS: Record<PluginLoadFailureReason['_tag'], Plugin.ExitClass> = {
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
    reason: PluginLoadFailureReason,
  },
) {
  get exitClass(): Plugin.ExitClass {
    return FAILURE_EXIT_CLASS[this.reason._tag]
  }

  override get message(): string {
    return `Failed to load plugin "${this.descriptor}" (${this.reason._tag})`
  }
}
