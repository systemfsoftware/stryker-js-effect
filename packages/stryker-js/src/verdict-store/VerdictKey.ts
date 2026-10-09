import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Result from 'effect/Result'

import { encodeVerdictKey, EncodeVerdictKeyCommand } from './encode-verdict-key.workflow.js'
import { type VerdictComponents, VerdictKey } from './VerdictEntry.schema.js'

export const verdictKeyOf = (components: VerdictComponents): VerdictKey => {
  const { encoding } = Result.merge(encodeVerdictKey(EncodeVerdictKeyCommand.make({ components })))
  return VerdictKey.make(bytesToHex(sha256(utf8ToBytes(encoding))))
}
