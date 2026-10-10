import { createHash } from 'node:crypto'
import { type Shard, shardCount, shardIndex } from './Parity.schema.js'

/**
 * The 1-based shard a repo-relative file name falls into, from a sha256 of that exact string.
 * Deterministic across platforms and runs; `count` must be at least 1.
 */
export const shardOf = (fileName: string, count: number): number => {
  const digest = createHash('sha256').update(fileName, 'utf8').digest('hex')
  return Number(BigInt(`0x${digest}`) % BigInt(count)) + 1
}

export const inShard = (fileName: string, shard: Shard): boolean =>
  shardOf(fileName, shardCount(shard)) === shardIndex(shard)
