import * as S from 'effect/Schema'

export class EngineIdentityUnreadable extends S.TaggedError<EngineIdentityUnreadable>()('EngineIdentityUnreadable', {
  manifest: S.String,
  cause: S.Unknown,
}) {
  override get message(): string {
    return `The engine's identity is unreadable: every path the "files" field of ${this.manifest} declares must exist`
  }
}

export const EngineManifestSchema = S.Struct({ files: S.Array(S.String) })
