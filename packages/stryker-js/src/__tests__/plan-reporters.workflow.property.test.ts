import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  HumanReporters,
  MachineReporters,
  planReporters,
  ReporterPlanCommand,
} from '../Reporter/plan-reporters.workflow.js'
import { HumanStreamRole, MachineStreamRole } from '../Reporter/reporter-role.schema.js'

const STREAM = 'progress-stream'
const HUMAN = 'clear-text'

const expectedHuman = (configured: readonly string[]): readonly string[] => {
  const planned: string[] = []
  for (const name of configured) {
    const mapped = name === STREAM ? HUMAN : name
    if (!planned.includes(mapped)) planned.push(mapped)
  }
  return planned
}

const expectedMachine = (configured: readonly string[], stdout: readonly string[]): readonly string[] => {
  const planned: string[] = []
  for (const name of configured) {
    if (!stdout.includes(name)) planned.push(name)
  }
  if (!planned.includes(STREAM)) planned.push(STREAM)
  return planned
}

const expectedFor = (command: ReporterPlanCommand) =>
  Match.value(command.mode).pipe(
    Match.when('human', () => ({ human: true, reporters: expectedHuman(command.configured) })),
    Match.when('machine', () => ({ human: false, reporters: expectedMachine(command.configured, command.stdout) })),
    Match.exhaustive,
  )

describe('planReporters', () => {
  it.prop(
    '∀c_RolesAndStdoutConfigured_≡ReferencePlanForMode',
    { of: [ReporterPlanCommand, S.Array(S.Union([MachineStreamRole, HumanStreamRole]))], subject: planReporters },
    (subject, [drawn, roles]) => {
      const command = ReporterPlanCommand.make({
        configured: [...drawn.configured, ...roles, ...drawn.stdout],
        stdout: drawn.stdout,
        mode: drawn.mode,
      })
      const expected = expectedFor(command)
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(HumanReporters)(decision) === expected.human &&
          S.is(MachineReporters)(decision) !== expected.human &&
          JSON.stringify(decision.reporters) === JSON.stringify(expected.reporters),
      })
    },
  )
})
