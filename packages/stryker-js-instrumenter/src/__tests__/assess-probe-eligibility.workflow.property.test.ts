import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  assessProbeEligibility,
  AssessProbeEligibilityCommand,
  MutantProbed,
  MutantUnprobed,
} from '../assess-probe-eligibility.workflow.js'

const PROBED_MUTATORS: ReadonlyArray<string> = [
  'ArithmeticOperator',
  'EqualityOperator',
  'UnaryOperator',
  'ConditionalExpression',
]
const ARITHMETIC_ORIGINALS: ReadonlyArray<string | null> = ['-', '*', '/', '%']
const ARITHMETIC_OPERATORS: ReadonlyArray<string | null> = ['+', '-', '*', '/', '%']
const RELATIONAL_OPERATORS: ReadonlyArray<string | null> = ['<', '<=', '>', '>=']
const COMPARISON_OPERATORS: ReadonlyArray<string | null> = ['<', '<=', '>', '>=', '==', '!=', '===', '!==']
const SIGN_OPERATORS: ReadonlyArray<string | null> = ['+', '-']

const proofHolds = (kind: MutantProbed['kind'], command: AssessProbeEligibilityCommand): boolean =>
  Match.value(command.site).pipe(
    Match.tagsExhaustive({
      BinarySwap: (swap) =>
        (kind === 'arithmetic' && command.mutatorName === 'ArithmeticOperator' &&
          ARITHMETIC_ORIGINALS.includes(swap.originalOperator) &&
          ARITHMETIC_OPERATORS.includes(swap.replacementOperator)) ||
        (kind === 'relational' && command.mutatorName === 'EqualityOperator' &&
          RELATIONAL_OPERATORS.includes(swap.originalOperator) &&
          COMPARISON_OPERATORS.includes(swap.replacementOperator)),
      UnarySwap: (swap) =>
        kind === 'unary' && command.mutatorName === 'UnaryOperator' &&
        SIGN_OPERATORS.includes(swap.originalOperator) && SIGN_OPERATORS.includes(swap.replacementOperator) &&
        swap.replacementOperator !== swap.originalOperator,
      ConstantReplacement: (replacement) =>
        kind === 'constant' &&
        (command.mutatorName === 'ConditionalExpression' || command.mutatorName === 'EqualityOperator') &&
        COMPARISON_OPERATORS.includes(replacement.comparedOperator) &&
        replacement.left === 'literal' && replacement.right === 'literal',
      UnrecognizedShape: () => false,
    }),
  )

describe('assessProbeEligibility', () => {
  it.prop(
    '∀c_Command_≡DecidedWithAnExplicitProbeState',
    { of: [AssessProbeEligibilityCommand], subject: assessProbeEligibility },
    (subject, [command]) => {
      const decided = subject(command)
      return Result.isSuccess(decided) &&
        (S.is(MutantProbed)(decided.success) || decided.success.reason !== 'not-decided')
    },
  )

  it.prop(
    '∀c_Command_≡ProbedOnlyWhereTheOperandsProveTheMutantValue',
    { of: [AssessProbeEligibilityCommand], subject: assessProbeEligibility },
    (subject, [command]) => {
      const decided = subject(command)
      return Result.isSuccess(decided) &&
        (S.is(MutantUnprobed)(decided.success) || proofHolds(decided.success.kind, command))
    },
  )

  it.prop(
    '∀c_Command_≡MutatorOutsideTheProbedSetIffUnprobedForItsMutator',
    { of: [AssessProbeEligibilityCommand], subject: assessProbeEligibility },
    (subject, [command]) => {
      const decided = subject(command)
      const outsideProbedSet = !PROBED_MUTATORS.includes(command.mutatorName)
      return Result.isSuccess(decided) &&
        outsideProbedSet === (S.is(MutantUnprobed)(decided.success) && decided.success.reason === 'mutator-not-probed')
    },
  )
})
