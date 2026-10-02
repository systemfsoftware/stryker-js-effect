import { Schema as S } from 'effect'
import * as Predicate from 'effect/Predicate'

import { FailureRecord, RunEvent } from '@systemfsoftware/stryker-js-cli-contract'

export class PluginNotFoundError extends S.TaggedError<PluginNotFoundError>()('PluginNotFoundError', {
  descriptor: S.String,
}) {
  get evidence(): FailureRecord.FailureEvidence {
    return { _tag: 'PluginNotFound', stage: 'config', descriptor: this.descriptor }
  }

  override get message(): string {
    return `Plugin "${this.descriptor}" was not found`
  }
}

export const PeerFailureTag = S.Literals(['PeerMissing', 'PeerVersionUnsupported', 'PeerUnrecognized'])
export type PeerFailureTag = typeof PeerFailureTag.Type

export class PluginLoadRefusedError extends S.TaggedError<PluginLoadRefusedError>()(
  'PluginLoadRefusedError',
  {
    descriptor: S.String,
    reason: RunEvent.PluginLoadFailureReason,
  },
) {
  get evidence(): FailureRecord.FailureEvidence {
    return Predicate.isTagged(this.reason, 'ImportFailed')
      ? { _tag: 'PluginImportFailed', stage: 'config', descriptor: this.descriptor }
      : { _tag: 'PluginLoadFailed', stage: 'config', descriptor: this.descriptor, reason: this.reason }
  }

  override get message(): string {
    return `Failed to load plugin "${this.descriptor}" (${this.reason._tag})`
  }
}
