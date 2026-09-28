import { Schema as S } from 'effect'

export const PluginLoadFailureReason = S.Union([
  S.TaggedStruct('PeerMissing', { peer: S.String }),
  S.TaggedStruct('PeerVersionUnsupported', { peer: S.String, detail: S.String }),
  S.TaggedStruct('PeerUnrecognized', { peer: S.String }),
  S.TaggedStruct('InvalidContribution', { detail: S.String }),
  S.TaggedStruct('ImportFailed', { cause: S.Unknown }),
])
export type PluginLoadFailureReason = typeof PluginLoadFailureReason.Type
