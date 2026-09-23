import { Effect, Schema as S } from 'effect'
import { it } from '@effect/vitest'
import { LineTableFromText } from '../src/Location.schema.js'
import * as Arbitrary from 'effect/unstable/arbitrary/Arbitrary'

const FRAGMENTS = S.Literals(['\r\n', '\r', '\n', '\u2028', '\u2029', 'a', ''])

const textArbitrary = Arbitrary.map(
  Arbitrary.array(Arbitrary.schema(FRAGMENTS)),
  (fragments) => fragments.join(''),
)

const offsetIn = (text: string) =>
  Arbitrary.map(
    Arbitrary.schema(S.Int),
    (draw) => ((draw % (text.length + 1)) + text.length + 1) % (text.length + 1),
  )

const textWithOffset = Arbitrary.flatMap(textArbitrary, (text) =>
  Arbitrary.map(offsetIn(text), (offset) => ({ text, offset })))

const holds = (text: string, offset: number): boolean =>
  typeof text === 'string' && typeof offset === 'number'

it.effect.prop('variant A destructures object', [textWithOffset], ({ text, offset }) =>
  Effect.succeed(holds(text, offset)))

it.effect.prop('variant B destructures tuple', [textWithOffset], (draws) =>
  Effect.succeed(Array.isArray(draws) && holds(draws[0].text, draws[0].offset)))
