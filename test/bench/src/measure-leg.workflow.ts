import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { LegClock, LegClockBehind, LegElapsed } from './leg-clock.schema.js'

export class MeasureLegCommand extends S.TaggedClass<MeasureLegCommand>()('MeasureLegCommand', {
  startedAtSeconds: S.Finite,
  nowMs: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const clockOf = (command: MeasureLegCommand): LegClock => {
  const elapsedMs = command.nowMs - command.startedAtSeconds * 1000
  return Boolean.match(elapsedMs >= 0, {
    onTrue: (): LegClock => LegElapsed.make({ wallMs: elapsedMs }),
    onFalse: (): LegClock => LegClockBehind.make({}),
  })
}

const decide = (command: MeasureLegCommand): Result.Result<LegClock, never> => Result.succeed(clockOf(command))

export const measureLeg = Workflow.make({
  command: MeasureLegCommand,
  decision: LegClock,
  error: S.Never,
  decide,
})

const clockFieldVerdicts = (value: number): ReadonlyArray<boolean> => [
  Result.isSuccess(S.decodeResult(MeasureLegCommand)({ _tag: 'MeasureLegCommand', startedAtSeconds: value, nowMs: 0 })),
  Result.isSuccess(S.decodeResult(MeasureLegCommand)({ _tag: 'MeasureLegCommand', startedAtSeconds: 0, nowMs: value })),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const boundaryValues = [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

  it.prop(
    '∀n_MeasureLegCommandRefusal_≡BothClockReadingsAreFinite',
    { of: [S.Finite], subject: clockFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(boundaryValues, drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === Number.isFinite(value)),
      ),
  )
}
