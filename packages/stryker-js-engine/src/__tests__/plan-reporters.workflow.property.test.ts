import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { HumanReporters, MachineReporters, planReporters, ReporterPlanCommand } from '../run/plan-reporters.workflow.js'

const STREAM = 'progress-stream'
const STDOUT_NAMES = ['clear-text', 'progress']

const decisionOf = (
  plan: typeof planReporters,
  command: ReporterPlanCommand,
): HumanReporters | MachineReporters | undefined =>
  Result.match(plan(command), {
    onFailure: () => undefined,
    onSuccess: (decision) => decision,
  })

const reportersOf = (plan: typeof planReporters, command: ReporterPlanCommand): readonly string[] | undefined => {
  const decision = decisionOf(plan, command)
  return decision === undefined ? undefined : [...decision.reporters]
}

const replannedHuman = (plan: typeof planReporters, reporters: readonly string[]) =>
  reportersOf(plan, ReporterPlanCommand.make({ configured: [...reporters], mode: 'human' }))

const replannedMachine = (plan: typeof planReporters, reporters: readonly string[]) =>
  reportersOf(plan, ReporterPlanCommand.make({ configured: [...reporters], mode: 'machine' }))

const deduped = (reporters: readonly string[]): boolean => new Set(reporters).size === reporters.length

describe('planReporters', () => {
  it.prop(
    '∀c_Human_≡NoStreamNameClosureAndIdempotent',
    { of: [ReporterPlanCommand], subject: planReporters },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      if (decision === undefined) return false
      if (command.mode === 'machine') return S.is(MachineReporters)(decision)
      const reporters = [...decision.reporters]
      return S.is(HumanReporters)(decision) &&
        !reporters.includes(STREAM) &&
        deduped(reporters) &&
        reporters.every((name) => name === 'clear-text' || command.configured.includes(name)) &&
        JSON.stringify(replannedHuman(subject, reporters)) === JSON.stringify(reporters)
    },
  )

  it.prop(
    '∀c_Machine_≡StreamPresentStdoutAbsentAndIdempotent',
    { of: [ReporterPlanCommand], subject: planReporters },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      if (decision === undefined) return false
      if (command.mode === 'human') return S.is(HumanReporters)(decision)
      const reporters = [...decision.reporters]
      return S.is(MachineReporters)(decision) &&
        reporters.includes(STREAM) &&
        STDOUT_NAMES.every((name) => !reporters.includes(name)) &&
        reporters.every((name) => name === STREAM || command.configured.includes(name)) &&
        JSON.stringify(replannedMachine(subject, reporters)) === JSON.stringify(reporters)
    },
  )
})
