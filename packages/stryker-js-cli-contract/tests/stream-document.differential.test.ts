import { Differential } from '@systemfsoftware/differential-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arbitrary from 'effect/Arbitrary'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'

import committedStreamDocument from '../contract/stream.schema.json' with { type: 'json' }
import { documentReaderOf } from './__fixtures__/stream-document.model.js'

const publishedDocument = S.decodeUnknownResult(S.Record(S.String, S.Json))(committedStreamDocument).pipe(
  Result.getOrThrow,
  documentReaderOf,
)

const RUN_BUDGET = 300

const isPosition = S.is(Mutant.Position)

const positionFirst = (left: Mutant.Position, right: Mutant.Position): boolean =>
  left.line < right.line || (left.line === right.line && left.column <= right.column)

const withLocationsInOrder = (node: S.Json): S.Json => {
  if (Array.isArray(node)) return node.map(withLocationsInOrder)
  if (typeof node !== 'object' || node === null) return node
  const held: Record<string, S.Json> = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, withLocationsInOrder(value)]),
  )
  const { start, end } = held
  if (isPosition(start) && isPosition(end) && !positionFirst(start, end)) {
    held['start'] = end
    held['end'] = start
  }
  return held
}

const sampledAt = <A>(arbitrary: Arbitrary.Arbitrary<A>) => (seed: number): A =>
  Effect.runSync(Arbitrary.sampleEffect(arbitrary, { count: 1, seed }))[0]

const documentLine = Arbitrary.schema(publishedDocument.codec).pipe(
  Arbitrary.map((json) => Option.getOrThrow(S.encodeOption(S.fromJsonString(S.Json))(withLocationsInOrder(json)))),
)

const codecLine = Arbitrary.schema(RunEvent.RunEventWireLine).pipe(
  Arbitrary.map((event) => Option.getOrThrow(S.encodeOption(RunEvent.RunEventWireLine)(event))),
)

const SEED = fc.integer({ min: 0, max: 2 ** 31 - 1 })

const wireLine = fc.oneof(SEED.map(sampledAt(documentLine)), SEED.map(sampledAt(codecLine)))

const codecReadingOf = (line: string): Option.Option<S.Json> =>
  S.decodeOption(RunEvent.RunEventWireLine)(line).pipe(
    Option.flatMap(S.encodeOption(RunEvent.RunEventWireLine)),
    Option.flatMap(S.decodeOption(S.fromJsonString(S.Json))),
  )

const sameReading = Option.makeEquivalence(S.toEquivalence(S.Json))

Differential.compare({
  name:
    'The published stream document and the wire codec agree on every line either one writes: both refuse it, or both reproduce the same JSON',
  reference: (line: string) => Effect.sync(() => publishedDocument.readingOf(line)),
  candidate: (line: string) => Effect.sync(() => codecReadingOf(line)),
})
  .on(wireLine, { runBudget: RUN_BUDGET })
  .assert(sameReading)
