import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  MutantKindMismatch,
  NoPlacerClaimsNode,
  type PlacementDecision,
  type PlacementFacts,
  placeMutants,
  PlaceMutantsCommand,
} from '../place-mutants.workflow.js'

const PlacementDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/PlacementDecision',
)

const hasBrand = (site: PlacementDecision): boolean =>
  Object.getOwnPropertySymbols(site).includes(PlacementDecisionTypeId)

const claimingFamily = (facts: PlacementFacts): 'expression' | 'statement' | 'switch-case' | undefined => {
  if (facts.isExpression && facts.expressionIsValid) {
    return 'expression'
  }
  if (facts.isStatement) {
    return 'statement'
  }
  if (facts.isSwitchCase) {
    return 'switch-case'
  }
  return undefined
}

describe('placeMutants', () => {
  it.prop(
    '∀c_Command_∈BrandedPlacement',
    { of: [PlaceMutantsCommand], subject: placeMutants },
    (subject, [command]) => {
      const decided = subject(command)
      return Result.isSuccess(decided)
        ? hasBrand(decided.success)
        : S.is(NoPlacerClaimsNode)(decided.failure) || S.is(MutantKindMismatch)(decided.failure)
    },
  )

  it.prop(
    '∀c_Command_≡SitedOrRefused',
    { of: [PlaceMutantsCommand], subject: placeMutants },
    (subject, [command]) => {
      const decided = subject(command)
      const family = claimingFamily(command.facts)
      if (family === undefined) {
        return Result.isFailure(decided) && S.is(NoPlacerClaimsNode)(decided.failure) &&
          decided.failure.fileName === command.fileName
      }
      const mismatched = command.mutants.find((mutant) =>
        family === 'expression'
          ? !mutant.replacement.isExpression
          : family === 'statement'
          ? !mutant.replacement.isStatement
          : !mutant.replacement.isSwitchCase
      )
      if (mismatched !== undefined) {
        return Result.isFailure(decided) && S.is(MutantKindMismatch)(decided.failure) &&
          decided.failure.mutantId === mismatched.id && decided.failure.mutatorName === mismatched.mutatorName &&
          decided.failure.placer === family
      }
      if (Result.isFailure(decided)) {
        return false
      }
      const first = command.mutants.at(0)
      return (first === undefined || decided.success.mutantIds.at(0) === first.id) &&
        decided.success.mutantIds.length === command.mutants.length
    },
  )
})
