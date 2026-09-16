import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import { type LocatedDirective, LocatedDirectiveSchema } from '../directives/directive.schema.js'
import {
  MutantsFullyIgnored,
  MutantsPlanned,
  MutantWithoutLocation,
  planMutants,
  PlanMutantsCommand,
} from '../plan-mutants.workflow.js'

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/MutantPlan')

const reasonFromRule = (rule: readonly LocatedDirective[], mutatorName: string, line: number): string | undefined => {
  const lower = mutatorName.toLowerCase()
  const reaching = rule.filter((located) =>
    (located.directive.scope !== 'next-line' || located.at.line === line) &&
    located.directive.mutatorNames.some((name) => name === 'all' || name.toLowerCase() === lower)
  )
  const last = reaching.at(-1)
  if (last === undefined) {
    return undefined
  }
  return last.directive.action === 'disable' ? last.directive.reason : undefined
}

const silencingReason = (command: PlanMutantsCommand, mutatorName: string): string | undefined => {
  const directive = reasonFromRule(command.rule, mutatorName, command.line)
  if (directive !== undefined) {
    return directive
  }
  if (command.excludedMutations.includes(mutatorName)) {
    return `Ignored because of excluded mutation "${mutatorName}"`
  }
  return command.candidates.find((candidate) => candidate.mutatorName === mutatorName)?.ignorerReason
}

describe('planMutants', () => {
  it.prop('∀d_Brand_∈Plan', [
    fc.constantFrom(
      new MutantsPlanned({ mutants: [], placeable: [], warnings: [], nextIndex: 0 }),
      new MutantsFullyIgnored({ mutants: [], warnings: [], nextIndex: 0 }),
    ),
  ], ([plan]) => Object.getOwnPropertySymbols(plan).includes(MutantPlanTypeId))

  it.prop('∀c_Command_≡IdsRunFromTheFoldState', [S.toArbitrary(PlanMutantsCommand)(fc)], ([command]) => {
    const planned = planMutants(command)
    const withoutLocation = command.candidates.find((candidate) => candidate.location === undefined)
    if (withoutLocation !== undefined) {
      return Result.isFailure(planned) && S.is(MutantWithoutLocation)(planned.failure) &&
        planned.failure.mutatorName === withoutLocation.mutatorName
    }
    if (Result.isFailure(planned)) {
      return false
    }
    const plan = planned.success
    const firstMutant = plan.mutants.at(0)
    const lastMutant = plan.mutants.at(-1)
    const lastIndex = command.firstIndex + command.candidates.length - 1
    return plan.mutants.length === command.candidates.length &&
      plan.nextIndex === command.firstIndex + command.candidates.length &&
      (firstMutant === undefined || firstMutant.id === `${command.firstIndex}`) &&
      (lastMutant === undefined || lastMutant.id === `${lastIndex}`) &&
      (S.is(MutantsFullyIgnored)(plan) ? plan.mutants.every((mutant) => mutant.ignoreReason !== undefined) : true)
  })

  it.prop(
    '∀c_Command_≡TheLastReachingDirectiveSuppliesTheReason',
    [S.toArbitrary(PlanMutantsCommand)(fc)],
    ([command]) => {
      const planned = planMutants(command)
      const candidate = command.candidates.at(0)
      if (candidate === undefined) {
        return Result.isSuccess(planned) && planned.success.mutants.length === 0
      }
      if (command.candidates.some((entry) => entry.location === undefined)) {
        return Result.isFailure(planned) && S.is(MutantWithoutLocation)(planned.failure)
      }
      if (Result.isFailure(planned)) {
        return false
      }
      return planned.success.mutants.at(0)?.ignoreReason === silencingReason(command, candidate.mutatorName)
    },
  )

  it.prop('∀d_DirectivePair_≡TheLaterDirectiveInTheRuleSuppliesTheReason', [
    S.toArbitrary(LocatedDirectiveSchema)(fc),
    S.toArbitrary(LocatedDirectiveSchema)(fc),
  ], ([earlier, later]) => {
    const mutatorName = 'ArithmeticOperator'
    const command = new PlanMutantsCommand({
      fileName: 'probe.ts',
      firstIndex: 0,
      offset: { line: 0, column: 0 },
      line: later.at.line,
      mutatorNames: [mutatorName],
      excludedMutations: [],
      rule: [
        { directive: { ...earlier.directive, action: 'disable', mutatorNames: [mutatorName] }, at: earlier.at },
        { directive: { ...later.directive, action: 'restore', mutatorNames: [mutatorName] }, at: later.at },
      ],
      directives: [],
      candidates: [
        { mutatorName, replacementCode: 'n - 1', location: { start: later.at, end: later.at } },
      ],
    })
    const planned = planMutants(command)
    return Result.isSuccess(planned) && planned.success.mutants.at(0)?.ignoreReason === undefined
  })
})
