import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { LegMeasured, LegNotMeasured, LegTargetMs, LegTime } from './bench-report.schema.js'

export class MeasureLegCommand extends S.TaggedClass<MeasureLegCommand>()('MeasureLegCommand', {
  startedAtSeconds: S.Finite,
  nowMs: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const legOf = (command: MeasureLegCommand): LegTime => {
  const elapsedMs = command.nowMs - command.startedAtSeconds * 1000
  return Boolean.match(elapsedMs >= 0, {
    onTrue: (): LegTime => LegMeasured.make({ wallMs: elapsedMs, targetMs: LegTargetMs.literal }),
    onFalse: (): LegTime => LegNotMeasured.make({ targetMs: LegTargetMs.literal }),
  })
}

const decide = (command: MeasureLegCommand): Result.Result<LegTime, never> => Result.succeed(legOf(command))

export const measureLeg = Workflow.make({
  command: MeasureLegCommand,
  decision: LegTime,
  error: S.Never,
  decide,
})
