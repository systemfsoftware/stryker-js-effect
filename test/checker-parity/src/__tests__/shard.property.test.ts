import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { decodeShard } from '../Parity.schema.js'
import { inShard, shardOf } from '../shard.js'

const countOf = (draw: number): number => Math.abs(draw) % 32 + 1
const range = (count: number): ReadonlyArray<number> => Array.from({ length: count }, (_, index) => index + 1)

describe('shardOf', () => {
  it.prop(
    '∀f,n_ShardOf_≡TheOnlyShardInShard',
    { of: [S.String, S.Int], subject: shardOf },
    (subject, [fileName, drawnCount]) => {
      const count = countOf(drawnCount)
      const shard = subject(fileName, count)
      const hits = range(count).filter((index) =>
        inShard(fileName, Result.getOrThrow(decodeShard(`${index}/${count}`)))
      )
      return Number.isInteger(shard) && shard >= 1 && shard <= count && hits.length === 1 && hits[0] === shard
    },
  )
})

describe('inShard', () => {
  it.prop(
    '∀f,n_EveryFile_≡ExactlyOneShard',
    { of: [S.String, S.Int], subject: inShard },
    (subject, [fileName, drawnCount]) => {
      const count = countOf(drawnCount)
      const hits = range(count).filter((index) =>
        subject(fileName, Result.getOrThrow(decodeShard(`${index}/${count}`)))
      )
      return hits.length === 1
    },
  )
})

describe('decodeShard', () => {
  it.prop(
    '∀k,n_Shard_≡DecodesExactlyWhenOneLeqKLeqN',
    { of: [S.Int, S.Int], subject: decodeShard },
    (subject, [index, count]) => {
      const valid = index >= 1 && count >= 1 && index <= count
      return Result.isSuccess(subject(`${index}/${count}`)) === valid
    },
  )
})
