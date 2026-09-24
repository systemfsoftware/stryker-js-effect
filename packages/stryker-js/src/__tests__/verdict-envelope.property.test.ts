import { describe, it } from '@effect/vitest'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { RunId, VerdictEnvelope } from '../reporting/verdict-envelope.schema.js'
import { ModeSignal, OutputMode } from '../run-event.schema.js'

const pathService = Effect.runSync(
  Effect.provide(
    Effect.gen(function*() {
      return yield* Path.Path
    }),
    Path.layer,
  ),
)

const arbitraryReport = Arbitrary.schema(MutationTestResultSchema)
const arbitraryMode = Arbitrary.schema(OutputMode)
const arbitrarySignal = Arbitrary.schema(ModeSignal)
const arbitraryMillis = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 })))

const buildOf = (report: MutationTestResultSchema['Type'], mode: OutputMode, signal: ModeSignal) =>
  VerdictEnvelope.build(report, mode, signal, RunId.generate(DateTime.makeUnsafe(0)).value, '/base', pathService)

const wireBytesOf = (envelope: VerdictEnvelope) => JSON.stringify(S.encodeSync(VerdictEnvelope)(envelope))

const mutantTotalOf = (report: MutationTestResultSchema['Type']) =>
  Arr.sum(Arr.map(Arr.fromIterable(Object.values(report.files)), (file) => file.mutants.length))

const CROCKFORD_RUN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

describe('VerdictEnvelope.build', () => {
  it.prop('∀rms_Envelope_≡WireRoundTripBytes', [arbitraryReport, arbitraryMode, arbitrarySignal], ([report, mode, signal]) => {
    const built = buildOf(report, mode, signal)
    const decoded = S.decodeUnknownSync(VerdictEnvelope)(S.encodeSync(VerdictEnvelope)(built))
    return wireBytesOf(decoded) === wireBytesOf(built)
  })

  it.prop(
    '∀rms_Score_≡NullIffEmptyOrNonFinite',
    [arbitraryReport, arbitraryMode, arbitrarySignal],
    ([report, mode, signal]) => {
      const { counts, score } = buildOf(report, mode, signal)
      const finite = counts.totalMutants > 0 && Number.isFinite(counts.mutationScore)
      return finite ? score === counts.mutationScore : score === null
    },
  )

  it.prop('∀r_Metrics_∋EveryMutantOnce', [arbitraryReport], ([report]) => {
    const { counts } = buildOf(report, 'machine', 'flag')
    return counts.totalMutants === mutantTotalOf(report)
  })
})

describe('RunId.generate', () => {
  it.prop('∀t_RunId_∈Crockford26', [arbitraryMillis], ([millis]) =>
    CROCKFORD_RUN_ID.test(RunId.generate(DateTime.makeUnsafe(millis)).value))

  it.prop('∀t_RunIdTimePrefix_≡Deterministic', [arbitraryMillis], ([millis]) => {
    const now = DateTime.makeUnsafe(millis)
    return RunId.generate(now).value.slice(0, 9) === RunId.generate(now).value.slice(0, 9)
  })

  it.prop('∀t_RunId_≡EncodeRoundTrip', [arbitraryMillis], ([millis]) => {
    const id = RunId.generate(DateTime.makeUnsafe(millis))
    return S.decodeUnknownSync(RunId)(S.encodeSync(RunId)(id)).value === id.value
  })

  it.prop('∀t1t2_RunIdTimePrefix_≤ForEarlierEpoch', [arbitraryMillis, arbitraryMillis], ([left, right]) => {
    const [earlier, later] = left <= right ? [left, right] : [right, left]
    return RunId.generate(DateTime.makeUnsafe(earlier)).value.slice(0, 9) <=
      RunId.generate(DateTime.makeUnsafe(later)).value.slice(0, 9)
  })
})
