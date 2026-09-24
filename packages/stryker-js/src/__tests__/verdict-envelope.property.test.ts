import { describe, it } from '@effect/vitest'
import { type MutationTestResult, MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { RunId, VerdictEnvelope } from '../reporting/verdict-envelope.schema.js'
import { ModeSignal, OutputMode } from '../run-event.schema.js'

const pathService = Effect.runSync(Effect.provide(Path.Path, Path.layer))

const buildOf = (report: MutationTestResult, mode: OutputMode, signal: ModeSignal) =>
  VerdictEnvelope.build(report, mode, signal, RunId.generate(DateTime.makeUnsafe(0)).value, '/base', pathService)

const mutantTotalOf = (report: MutationTestResult) =>
  Object.values(report.files).reduce((total, file) => total + file.mutants.length, 0)

describe('VerdictEnvelope.build', () => {
  it.prop(
    '∀rms_Score_≡NullIffEmptyOrNonFinite',
    [MutationTestResultSchema, OutputMode, ModeSignal],
    ([report, mode, signal]) => {
      const { counts, score } = buildOf(report, mode, signal)
      const scoreDefined = counts.totalMutants > 0 && Number.isFinite(counts.mutationScore)
      return (scoreDefined && score === counts.mutationScore) || (!scoreDefined && score === null)
    },
  )

  it.prop('∀r_Metrics_∋EveryMutantOnce', [MutationTestResultSchema], ([report]) => {
    const { counts } = buildOf(report, 'machine', 'flag')
    return counts.totalMutants === mutantTotalOf(report)
  })
})

describe('RunId.generate', () => {
  it.prop(
    '∀t_RunIdTimePrefix_≡Deterministic',
    [S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 }))],
    ([millis]) => {
      const now = DateTime.makeUnsafe(millis)
      return RunId.generate(now).value.slice(0, 9) === RunId.generate(now).value.slice(0, 9)
    },
  )

  it.prop(
    '∀bd_RunIdTimePrefix_<ForLaterEpoch',
    [
      S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 - 2 ** 16 })),
      S.Int.check(S.isBetween({ minimum: 8, maximum: 2 ** 16 })),
    ],
    ([base, delta]) =>
      RunId.generate(DateTime.makeUnsafe(base)).value.slice(0, 9) <
        RunId.generate(DateTime.makeUnsafe(base + delta)).value.slice(0, 9),
  )
})
