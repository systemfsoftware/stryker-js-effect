import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Order from 'effect/Order'
import * as Str from 'effect/String'

export const DEFAULT_BLOCK_MUTANTS = 64

export const blocksOf: {
  (blockMutants: number): <A extends { readonly id: string }>(
    mutants: ReadonlyArray<A>,
  ) => ReadonlyArray<Arr.NonEmptyReadonlyArray<A>>
  <A extends { readonly id: string }>(
    mutants: ReadonlyArray<A>,
    blockMutants: number,
  ): ReadonlyArray<Arr.NonEmptyReadonlyArray<A>>
} = dual(
  2,
  <A extends { readonly id: string }>(
    mutants: ReadonlyArray<A>,
    blockMutants: number,
  ): ReadonlyArray<Arr.NonEmptyReadonlyArray<A>> =>
    Arr.chunksOf(Arr.sort(mutants, Order.mapInput(Str.Order, (mutant: A) => mutant.id)), blockMutants),
)
