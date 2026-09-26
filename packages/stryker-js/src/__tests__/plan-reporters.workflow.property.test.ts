import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { HumanReporters, MachineReporters, planReporters, ReporterPlanCommand } from '../run/plan-reporters.workflow.js'

const reporterNameArb = Arbitrary.schema(
  S.Literals(['clear-text', 'progress', 'progress-stream', 'json', 'html']),
)
const configuredArb = Arbitrary.array(reporterNameArb, { maxLength: 5 })

const reportersOf = (plan: typeof planReporters, mode: 'human' | 'machine', configured: readonly string[]) => {
  const result = plan(ReporterPlanCommand.make({ configured: [...configured], mode }))
  return Result.isSuccess(result) ? result.success : undefined
}

describe('planReporters', () => {
  it.prop(
    '∀c_Human_≡StreamMapsToClearTextAndDedupes',
    { of: [configuredArb], subject: planReporters },
    (subject, [configured]) => {
      const decision = reportersOf(subject, 'human', configured)
      if (decision === undefined || !S.is(HumanReporters)(decision)) {
        return false
      }
      const expected = [...new Set(configured.map((name) => (name === 'progress-stream' ? 'clear-text' : name)))]
      return JSON.stringify([...decision.reporters]) === JSON.stringify(expected)
    },
  )

  it.prop(
    '∀c_Machine_≡StdoutReportersDroppedAndStreamAppended',
    { of: [configuredArb], subject: planReporters },
    (subject, [configured]) => {
      const decision = reportersOf(subject, 'machine', configured)
      if (decision === undefined || !S.is(MachineReporters)(decision)) {
        return false
      }
      const permitted = configured.filter((name) => name !== 'clear-text' && name !== 'progress')
      const expected = permitted.includes('progress-stream') ? permitted : [...permitted, 'progress-stream']
      return JSON.stringify([...decision.reporters]) === JSON.stringify(expected)
    },
  )
})
