import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

const MUTANT_ID_HEX_LENGTH = 16

const lengthPrefixed = (value: string): string => `${value.length}:${value}`

export interface MutantTuple {
  readonly fileName: string
  readonly mutatorName: string
  readonly originalCode: string
  readonly replacementCode: string
}

export interface MutantIdentity extends MutantTuple {
  readonly ordinal: number
}

const tupleFields = (tuple: MutantTuple): readonly string[] => [
  tuple.fileName,
  tuple.mutatorName,
  tuple.originalCode,
  tuple.replacementCode,
]

export const mutantTupleKey = (tuple: MutantTuple): string => tupleFields(tuple).map(lengthPrefixed).join('')

export const mutantIdOf = (identity: MutantIdentity): Mutant.MutantId =>
  Mutant.MutantId.make(
    bytesToHex(sha256(utf8ToBytes([...tupleFields(identity), `${identity.ordinal}`].map(lengthPrefixed).join(''))))
      .slice(
        0,
        MUTANT_ID_HEX_LENGTH,
      ),
  )
