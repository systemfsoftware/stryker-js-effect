import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { type LocatedDirective, LocatedDirectiveSchema } from '../directives/directive.schema.js'
import {
  MutantsFullyIgnored,
  MutantsPlanned,
  MutantWithoutLocation,
  planMutants,
  PlanMutantsCommand,
} from '../plan-mutants.workflow.js'

const reasonFromRule = (rule: readonly LocatedDirective[], mutatorName: string, line: number): string | undefined => {
  const lower = mutatorName.toLowerCase()
  const reaching = rule.filter((located) =>
    (located.directive.scope !== 'next-line' || located.governedLine === line) &&
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

const Namespace = Arbitrary.schema(S.Literals(['acme', 'beta']))
const PascalName = Arbitrary.schema(S.String.check(S.isPattern(/^[A-Z][A-Za-z0-9]*$/)))

const providerDirective = (mutatorName: string, reason: string): LocatedDirective => ({
  directive: { action: 'disable', scope: 'next-line', mutatorNames: [mutatorName], reason },
  at: { line: 1, column: 1 },
  governedLine: 2,
})

const providerCandidate = (mutatorName: string) => ({
  mutatorName,
  replacementCode: 'n - 1',
  location: { start: { line: 2, column: 1 }, end: { line: 2, column: 2 } },
})

describe('planMutants', () => {
  it.prop(
    '∀c_Command_≡IdsRunFromTheFoldState',
    { of: [PlanMutantsCommand], subject: planMutants },
    (subject, [command]) => {
      const planned = subject(command)
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
    },
  )

  it.prop(
    '∀c_Command_≡PlaceableIdsNameExactlyTheUnignoredMutants',
    { of: [PlanMutantsCommand], subject: planMutants },
    (subject, [command]) => {
      const planned = subject(command)
      if (command.candidates.some((candidate) => candidate.location === undefined)) {
        return Result.isFailure(planned) && S.is(MutantWithoutLocation)(planned.failure)
      }
      if (Result.isFailure(planned)) {
        return false
      }
      const plan = planned.success
      const unignored = plan.mutants
        .filter((mutant) => mutant.ignoreReason === undefined)
        .map((mutant) => mutant.id)
      return S.is(MutantsPlanned)(plan)
        ? plan.placeableIds.length === unignored.length &&
          plan.placeableIds.every((id, index) => id === unignored[index])
        : unignored.length === 0
    },
  )

  it.prop(
    '∀c_Command_≡TheLastReachingDirectiveSuppliesTheReason',
    { of: [PlanMutantsCommand], subject: planMutants },
    (subject, [command]) => {
      const planned = subject(command)
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

  it.prop(
    '∀dd_DirectivePair_≡TheLaterDirectiveInTheRuleSuppliesTheReason',
    { of: [LocatedDirectiveSchema, LocatedDirectiveSchema], subject: planMutants },
    (subject, [earlier, later]) => {
      const mutatorName = 'ArithmeticOperator'
      const command = PlanMutantsCommand.make({
        fileName: 'probe.ts',
        firstIndex: 0,
        offset: { line: 1, columnShift: 0 },
        line: later.governedLine,
        mutatorNames: [mutatorName],
        excludedMutations: [],
        rule: [
          { ...earlier, directive: { ...earlier.directive, action: 'disable', mutatorNames: [mutatorName] } },
          { ...later, directive: { ...later.directive, action: 'restore', mutatorNames: [mutatorName] } },
        ],
        directives: [],
        candidates: [
          {
            mutatorName,
            replacementCode: 'n - 1',
            location: {
              start: { ...later.at, line: later.governedLine },
              end: { ...later.at, line: later.governedLine },
            },
          },
        ],
      })
      const planned = subject(command)
      return Result.isSuccess(planned) && planned.success.mutants.at(0)?.ignoreReason === undefined
    },
  )

  it.prop(
    '∀n_NamespacedDirective_≡SuppressesTheProviderMutant',
    { of: [Namespace, PascalName], subject: planMutants },
    (subject, [namespace, name]) => {
      const mutatorName = `${namespace}/${name}`
      const command = PlanMutantsCommand.make({
        fileName: 'probe.ts',
        firstIndex: 0,
        offset: { line: 1, columnShift: 0 },
        line: 2,
        mutatorNames: [mutatorName.toLowerCase()],
        excludedMutations: [],
        rule: [providerDirective(mutatorName, 'the provider said so')],
        directives: [],
        candidates: [providerCandidate(mutatorName)],
      })
      const planned = subject(command)
      return Result.isSuccess(planned) && planned.success.mutants.at(0)?.ignoreReason === 'the provider said so'
    },
  )

  it.prop(
    '∀n_UnknownNamespacedDirective_≡WarnsItIsUnused',
    { of: [Namespace, PascalName], subject: planMutants },
    (subject, [namespace, name]) => {
      const mutatorName = `${namespace}/${name}`
      const command = PlanMutantsCommand.make({
        fileName: 'probe.ts',
        firstIndex: 0,
        offset: { line: 1, columnShift: 0 },
        line: 2,
        mutatorNames: [],
        excludedMutations: [],
        rule: [],
        directives: [providerDirective(mutatorName, 'the provider said so')],
        candidates: [providerCandidate('ArithmeticOperator')],
      })
      const planned = subject(command)
      return Result.isSuccess(planned) &&
        planned.success.warnings.join('\n').includes(`'${mutatorName}' not found`)
    },
  )
})
