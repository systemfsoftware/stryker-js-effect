import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BudgetExceeded, budgetGate, BudgetGateCommand, BudgetInputUnusable } from '../budget-gate.workflow.js'

const allowedSecondsOf = (baselineSeconds: number, tolerance: number): number => baselineSeconds * (1 + tolerance)

const gatingWith = (command: BudgetGateCommand): BudgetGateCommand =>
  BudgetGateCommand.make({
    actualSeconds: command.actualSeconds,
    baseline: command.baseline,
    tolerance: command.tolerance,
    updateBaseline: false,
    baselineFile: command.baselineFile,
  })

describe('budgetGate', () => {
  it.prop(
    '∀c_BudgetGateCommand_≡UpdatingWritesTheRunActualSeconds',
    { of: [BudgetGateCommand], subject: budgetGate },
    (subject, [command]) => {
      const updating = BudgetGateCommand.make({
        actualSeconds: command.actualSeconds,
        baseline: command.baseline,
        tolerance: command.tolerance,
        updateBaseline: true,
        baselineFile: command.baselineFile,
      })
      const decided = Result.getOrThrow(subject(updating))
      return decided.baseline !== null && decided.baseline.actualSeconds === command.actualSeconds
    },
  )

  it.prop(
    '∀c_BudgetGateCommand_≡ExceededOnlyAboveBaselinePlusTolerance',
    { of: [BudgetGateCommand], subject: budgetGate },
    (subject, [command]) => {
      const outcome = subject(gatingWith(command))
      return Option.match(Option.fromNullishOr(command.baseline), {
        onNone: () =>
          Result.match(outcome, {
            onSuccess: () => false,
            onFailure: (failure) => S.is(BudgetInputUnusable)(failure),
          }),
        onSome: (baseline) => {
          const allowedSeconds = allowedSecondsOf(baseline.actualSeconds, command.tolerance)
          const over = command.actualSeconds > allowedSeconds
          return Result.match(outcome, {
            onSuccess: (decided) => !over && decided.baseline === null,
            onFailure: (failure) =>
              over &&
              S.is(BudgetExceeded)(failure) &&
              failure.baselineSeconds === baseline.actualSeconds &&
              failure.allowedSeconds === allowedSeconds &&
              failure.actualSeconds === command.actualSeconds,
          })
        },
      })
    },
  )
})
