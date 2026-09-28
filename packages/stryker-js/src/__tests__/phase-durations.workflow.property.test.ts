import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { phaseDurationsOf, type PhaseMark } from '../phase-durations.js'

const CANONICAL_PHASES: ReadonlyArray<RunEvent.RunPhase> = ['prepare', 'instrument', 'dry-run', 'mutation-test']

const BOUNDARY_PHASES: ReadonlyArray<RunEvent.RunPhase> = ['instrument', 'dry-run', 'mutation-test']

const PHASE_WINDOW_MS = 3_600_000

const scaledMsOf = (magnitude: number): number => (magnitude / (1 + magnitude)) * PHASE_WINDOW_MS

const marksOf = (
  entered: ReadonlyArray<RunEvent.RunPhase>,
  gaps: ReadonlyArray<number>,
): ReadonlyArray<PhaseMark> => {
  let elapsedMs = 0
  return CANONICAL_PHASES.filter((phase) => entered.includes(phase)).map((phase, index) => {
    elapsedMs += scaledMsOf(gaps[index] ?? 0)
    return { phase, elapsedMs }
  })
}

const totalOf = (durations: RunEvent.PhaseDurations): number =>
  durations.prepare + durations.instrument + durations['dry-run'] + durations['mutation-test']

describe('phaseDurationsOf', () => {
  it.prop(
    '∀m_PhaseMarks_≡ThePhaseDurationsAddUpToTheElapsedTime',
    {
      of: [S.Array(RunEvent.RunPhase), S.Array(Report.NonNegativeFinite), Report.NonNegativeFinite],
      subject: phaseDurationsOf,
    },
    (subject, [entered, gaps, tail]) => {
      const marks = marksOf(entered, gaps)
      const elapsedMs = (marks.at(-1)?.elapsedMs ?? 0) + scaledMsOf(tail)
      const boundedEveryPhase = BOUNDARY_PHASES.every((phase) => entered.includes(phase))
      return Option.match(subject({ marks, elapsedMs }), {
        onNone: () => !boundedEveryPhase,
        onSome: (durations) =>
          boundedEveryPhase &&
          Math.abs(totalOf(durations) - elapsedMs) <= Number.EPSILON * 16 * elapsedMs &&
          durations.prepare >= 0 &&
          durations.instrument >= 0 &&
          durations['dry-run'] >= 0 &&
          durations['mutation-test'] >= 0,
      })
    },
  )
})
