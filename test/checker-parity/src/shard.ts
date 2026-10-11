import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { dual } from 'effect/Function'

import { type Shard, shardCount, shardIndex } from './Parity.schema.js'

/**
 * The 1-based shard a repo-relative file name falls into, from a sha256 of that exact string.
 * Deterministic across platforms and runs; `count` must be at least 1.
 */
export const shardOf: {
  (count: number): (fileName: string) => number
  (fileName: string, count: number): number
} = dual(
  2,
  (fileName: string, count: number): number =>
    Number(BigInt(`0x${bytesToHex(sha256(utf8ToBytes(fileName)))}`) % BigInt(count)) + 1,
)

export const inShard: {
  (shard: Shard): (fileName: string) => boolean
  (fileName: string, shard: Shard): boolean
} = dual(
  2,
  (fileName: string, shard: Shard): boolean => shardOf(fileName, shardCount(shard)) === shardIndex(shard),
)
