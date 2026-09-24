import { describe, it } from '@effect/vitest'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'
import { pathToFileURL } from 'node:url'

import { AnsiCode, AnsiColor } from '../reporting/ansi.schema.js'
import { RunId, VerdictEnvelope } from '../reporting/verdict-envelope.schema.js'
import { ModeSignal, OutputMode } from '../run-event.schema.js'

interface BaselineAnsi {
  readonly ansi: Record<AnsiColor, (text: string) => string>
}

interface BaselineVerdictEnvelopeModule {
  readonly generateRunId: (now: DateTime.Utc) => string
  readonly buildVerdictEnvelope: {
    (
      report: unknown,
      mode: OutputMode,
      signal: ModeSignal,
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ): Record<string, unknown>
    (
      mode: OutputMode,
      signal: ModeSignal,
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ): (report: unknown) => Record<string, unknown>
  }
}

const BASELINE_SOURCE_DIR = '/tmp/refactor/baseline/packages/stryker-js/src'

const baselineVerdictEnvelopeOf: Effect.Effect<BaselineVerdictEnvelopeModule> = Effect.promise(
  (): Promise<BaselineVerdictEnvelopeModule> =>
    import(pathToFileURL(`${BASELINE_SOURCE_DIR}/verdict-envelope.ts`).href),
)

const baselineAnsiOf: Effect.Effect<BaselineAnsi> = Effect.promise(
  (): Promise<BaselineAnsi> => import(pathToFileURL(`${BASELINE_SOURCE_DIR}/Reporter.ansi.ts`).href),
)

const pathService = Effect.runSync(Effect.provide(Path.Path, Path.layer))

const CROCKFORD_RUN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

const baselineDefinedReportArb = Arbitrary.schema(MutationTestResultSchema).pipe(
  Arbitrary.map((report) => ({
    ...report,
    files: Object.fromEntries(
      Object.entries(report.files).map(([fileName, file]) => [
        fileName in Object.prototype ? `src/${fileName}` : fileName,
        file,
      ]),
    ),
  })),
)

describe('verdict envelope old vs new (throwaway baseline evidence)', () => {
  it.effect.prop(
    '∀rms_NewWire_≡OldEnvelopeBytes',
    [baselineDefinedReportArb, OutputMode, ModeSignal],
    ([report, mode, signal]) =>
      Effect.gen(function*() {
        const baseline = yield* baselineVerdictEnvelopeOf
        const runId = baseline.generateRunId(DateTime.makeUnsafe(0))
        const built = VerdictEnvelope.build(report, mode, signal, runId, '/base', pathService)
        const encoded = yield* S.encodeEffect(VerdictEnvelope)(built)
        const old = baseline.buildVerdictEnvelope(report, mode, signal, runId, '/base', pathService)
        return JSON.stringify(encoded) === JSON.stringify(old)
      }),
  )

  it.effect.prop(
    '∀rms_Curried_≡DirectForm',
    [MutationTestResultSchema, OutputMode, ModeSignal],
    ([report, mode, signal]) => {
      const runId = RunId.generate(DateTime.makeUnsafe(0)).value
      const direct = VerdictEnvelope.build(report, mode, signal, runId, '/base', pathService)
      const curried = VerdictEnvelope.build(mode, signal, runId, '/base', pathService)(report)
      return Effect.succeed(JSON.stringify(direct) === JSON.stringify(curried))
    },
  )

  it.effect.prop('∀t_NewRunId_≡OldFormatAndPrefix', [S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 }))], ([
    millis,
  ]) =>
    Effect.gen(function*() {
      const baseline = yield* baselineVerdictEnvelopeOf
      const now = DateTime.makeUnsafe(millis)
      const newId = RunId.generate(now).value
      const oldId = baseline.generateRunId(now)
      return CROCKFORD_RUN_ID.test(oldId) && newId.slice(0, 9) === oldId.slice(0, 9)
    }))

  it.effect.prop('∀ct_Tint_≡OldAnsiWrap', [AnsiColor, S.String], ([color, text]) =>
    Effect.gen(function*() {
      const baseline = yield* baselineAnsiOf
      const tinted = `${AnsiCode.fields[color].literal}${text}${AnsiCode.fields.reset.literal}`
      return tinted === baseline.ansi[color](text)
    }))
})
