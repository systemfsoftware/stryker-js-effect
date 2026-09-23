import { expect, it } from 'vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { MutationRangeSpecifierSchema } from './MutationRange.schema.js'

const stringOf = Option.match({ onNone: () => '<none>' as const, onSome: (s: string) => JSON.stringify(s) })

it('post-fix steps', () => {
  const value = { file: '', startLine: 0, endLine: 0 }
  const encodeOption = Schema.encodeOption(MutationRangeSpecifierSchema)
  const decodeOption = Schema.decodeOption(MutationRangeSpecifierSchema)
  const enc1 = encodeOption(value)
  expect(Option.isSome(enc1), `enc1=${stringOf(enc1)}`).toBe(true)
  const dec1 = Option.getOrUndefined(Option.flatMap(enc1, decodeOption))
  expect(dec1, `dec1=${JSON.stringify(dec1)}`).toStrictEqual(value)
  const enc2 = dec1 === undefined ? Option.none() : encodeOption(dec1)
  expect(Option.isSome(enc2), `enc2=${stringOf(enc2)}`).toBe(true)
  const encodedSchema = Schema.toEncoded(MutationRangeSpecifierSchema)
  const verdict = Option.match(enc2, {
    onNone: () => false,
    onSome: (second) => Option.match(enc1, { onNone: () => false, onSome: (first) => second === first }),
  })
  expect(verdict, `enc2=${stringOf(enc2)} enc1=${stringOf(enc1)} ast=${String(encodedSchema.ast)}`).toBe(true)
})
