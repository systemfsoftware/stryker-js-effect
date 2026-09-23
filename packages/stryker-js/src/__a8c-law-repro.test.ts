import { expect, it } from 'vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { MutationRangeSpecifierSchema } from './MutationRange.schema.js'

const stringOf = Option.match({ onNone: () => '<none>', onSome: (s: string) => JSON.stringify(s) })

it('enc-stability steps', () => {
  const value = { file: '', startLine: 0, endLine: 0 }
  const encodeOption = Schema.encodeOption(MutationRangeSpecifierSchema)
  const decodeOption = Schema.decodeOption(MutationRangeSpecifierSchema)
  const enc1 = encodeOption(value)
  expect(Option.isSome(enc1), `enc1=${stringOf(enc1)}`).toBe(true)
  const dec1 = Option.getOrUndefined(Option.flatMap(enc1, decodeOption))
  expect(dec1, 'dec(enc(x)) === x').toStrictEqual(value)
  const enc2 = dec1 === undefined ? Option.none() : encodeOption(dec1)
  expect(Option.isSome(enc2), `enc2=${stringOf(enc2)}`).toBe(true)
  const encodedSchema = Schema.toEncoded(MutationRangeSpecifierSchema)
  const encodedEq = Schema.toEquivalence(encodedSchema)
  expect(
    Option.match(enc2, {
      onNone: () => false,
      onSome: (second) =>
        Option.match(enc1, { onNone: () => false, onSome: (first) => encodedEq(second, first) }),
    }),
    `enc2=${stringOf(enc2)} vs enc1=${stringOf(enc1)}; encodedAst=${String(encodedSchema.ast)}`,
  ).toBe(true)
})
