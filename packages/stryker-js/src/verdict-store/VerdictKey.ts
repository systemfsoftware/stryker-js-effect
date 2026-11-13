import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Result from 'effect/Result'

import { encodeVerdictKey, EncodeVerdictKeyCommand } from './encode-verdict-key.workflow.js'
import { type VerdictComponents, VerdictKey } from './VerdictEntry.schema.js'
import { VerdictKeyScheme } from './VerdictKeyScheme.schema.js'

export interface VerdictLocation {
  readonly key: VerdictKey
  readonly directory: string
}

export const verdictLocationAt = (scheme: VerdictKeyScheme) => (components: VerdictComponents): VerdictLocation => {
  const { encoding, directory } = Result.merge(encodeVerdictKey(EncodeVerdictKeyCommand.make({ scheme, components })))
  return { key: VerdictKey.make(bytesToHex(sha256(utf8ToBytes(encoding)))), directory }
}

export const verdictKeyOf = (components: VerdictComponents): VerdictKey =>
  verdictLocationAt(VerdictKeyScheme)(components).key
