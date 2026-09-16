import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import { type PlacementFacts } from '../place-mutants.workflow.js'
import {
  ExpressionSite,
  MutantKindMismatch,
  NoPlacerClaimsNode,
  placeMutants,
  PlaceMutantsCommand,
  StatementSite,
  SwitchCaseSite,
} from '../place-mutants.workflow.js'

const PlacementDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/PlacementDecision')

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
  it.prop('∀d_Brand_∈Decision', [
    fc.constantFrom(
      new ExpressionSite({ fileName: 'a.ts', mutantIds: [] }),
      new StatementSite({ fileName: 'a.ts', mutantIds: [] }),
      new SwitchCaseSite({ fileName: 'a.ts', mutantIds: [] }),
    ),
  ], ([site]) => Object.getOwnPropertySymbols(site).includes(PlacementDecisionTypeId))

  it.prop('∀c_Command_≡SitedOrRefused', [S.toArbitrary(PlaceMutantsCommand)(fc)], ([command]) => {
    const decided = placeMutants(command)
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
  })
})
