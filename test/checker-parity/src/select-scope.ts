import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Order from 'effect/Order'
import * as Str from 'effect/String'

const digestHex = (value: string): string => bytesToHex(sha256(utf8ToBytes(value)))

export const driftLegOf: {
  (shardCount: number): (rank: number) => number
  (rank: number, shardCount: number): number
} = dual(2, (rank: number, shardCount: number): number => (rank % shardCount) + 1)

export const sampleFileOrder: {
  (seed: string): (files: ReadonlyArray<string>) => ReadonlyArray<string>
  (seed: string, files: ReadonlyArray<string>): ReadonlyArray<string>
} = dual(
  2,
  (seed: string, files: ReadonlyArray<string>): ReadonlyArray<string> =>
    Arr.sort(
      files,
      Order.combine(Order.mapInput(Str.Order, (file: string) => digestHex(`${seed}\u0000${file}`)), Str.Order),
    ),
)
