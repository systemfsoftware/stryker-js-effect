import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const OperandKind = S.Literals(['literal', 'other'])

const BinaryOperator = S.Literals([
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  '<<',
  '>>',
  '>>>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '|',
  '^',
  '&',
  'in',
  'instanceof',
])

const UnaryOperator = S.Literals(['-', '+', '!', '~', 'typeof', 'void', 'delete'])

const BinarySwap = S.TaggedStruct('BinarySwap', {
  originalOperator: BinaryOperator,
  replacementOperator: BinaryOperator,
})
type BinarySwap = typeof BinarySwap.Type

const UnarySwap = S.TaggedStruct('UnarySwap', {
  originalOperator: UnaryOperator,
  replacementOperator: S.NullOr(UnaryOperator),
})
type UnarySwap = typeof UnarySwap.Type

const ConstantReplacement = S.TaggedStruct('ConstantReplacement', {
  comparedOperator: S.NullOr(BinaryOperator),
  left: OperandKind,
  right: OperandKind,
})
type ConstantReplacement = typeof ConstantReplacement.Type

const UnrecognizedShape = S.TaggedStruct('UnrecognizedShape', {})

export const ProbeSite = S.Union([BinarySwap, UnarySwap, ConstantReplacement, UnrecognizedShape])
export type ProbeSite = typeof ProbeSite.Type

const ProbedMutatorName = S.Literals([
  'ArithmeticOperator',
  'EqualityOperator',
  'UnaryOperator',
  'ConditionalExpression',
])
type ProbedMutatorName = typeof ProbedMutatorName.Type

export class AssessProbeEligibilityCommand
  extends S.TaggedClass<AssessProbeEligibilityCommand>()('AssessProbeEligibilityCommand', {
    mutatorName: S.Union([ProbedMutatorName, S.String]),
    site: ProbeSite,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ProbeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/ProbeDecision',
)
type ProbeDecisionTypeId = typeof ProbeDecisionTypeId

export class MutantProbed extends S.TaggedClass<MutantProbed>()('MutantProbed', {
  kind: Mutant.ProbeKind,
}) {
  readonly [ProbeDecisionTypeId] = ProbeDecisionTypeId
}

export class MutantUnprobed extends S.TaggedClass<MutantUnprobed>()('MutantUnprobed', {
  reason: Mutant.UnprobedReason,
}) {
  readonly [ProbeDecisionTypeId] = ProbeDecisionTypeId
}

export type ProbeDecision = MutantProbed | MutantUnprobed

type OperatorTable = Readonly<Record<string, true>>

const PROBED_ARITHMETIC_ORIGINALS: OperatorTable = { '-': true, '*': true, '/': true, '%': true }
const ARITHMETIC_OPERATORS: OperatorTable = { '+': true, ...PROBED_ARITHMETIC_ORIGINALS }
const RELATIONAL_OPERATORS: OperatorTable = { '<': true, '<=': true, '>': true, '>=': true }
const EQUALITY_OPERATORS: OperatorTable = { '==': true, '!=': true, '===': true, '!==': true }
const COMPARISON_OPERATORS: OperatorTable = { ...RELATIONAL_OPERATORS, ...EQUALITY_OPERATORS }
const SIGN_OPERATORS: OperatorTable = { '+': true, '-': true }

const isIn = (table: OperatorTable, operator: string): boolean => table[operator] === true

const probed = (kind: Mutant.ProbeKind): ProbeDecision => MutantProbed.make({ kind })
const unprobed = (reason: Mutant.UnprobedReason): ProbeDecision => MutantUnprobed.make({ reason })
const SHAPE_NOT_RECOGNIZED = (): ProbeDecision => unprobed('shape-not-recognized')

const arithmeticSwap = (swap: BinarySwap): ProbeDecision =>
  Boolean.match(isIn(PROBED_ARITHMETIC_ORIGINALS, swap.originalOperator), {
    onFalse: () => unprobed('operator-not-probed'),
    onTrue: () =>
      Boolean.match(isIn(ARITHMETIC_OPERATORS, swap.replacementOperator), {
        onFalse: SHAPE_NOT_RECOGNIZED,
        onTrue: () => probed('arithmetic'),
      }),
  })

const nonRelationalEqualitySwap = (swap: BinarySwap): ProbeDecision =>
  Boolean.match(isIn(EQUALITY_OPERATORS, swap.originalOperator), {
    onFalse: () => unprobed('operator-not-probed'),
    onTrue: () => unprobed('every-reach-infects'),
  })

const equalitySwap = (swap: BinarySwap): ProbeDecision =>
  Boolean.match(isIn(RELATIONAL_OPERATORS, swap.originalOperator), {
    onFalse: () => nonRelationalEqualitySwap(swap),
    onTrue: () =>
      Boolean.match(isIn(COMPARISON_OPERATORS, swap.replacementOperator), {
        onFalse: SHAPE_NOT_RECOGNIZED,
        onTrue: () => probed('relational'),
      }),
  })

const binarySwap = (mutator: ProbedMutatorName, swap: BinarySwap): ProbeDecision =>
  Match.value(mutator).pipe(
    Match.when('ArithmeticOperator', () => arithmeticSwap(swap)),
    Match.when('EqualityOperator', () => equalitySwap(swap)),
    Match.when('UnaryOperator', SHAPE_NOT_RECOGNIZED),
    Match.when('ConditionalExpression', SHAPE_NOT_RECOGNIZED),
    Match.exhaustive,
  )

const FLIPPED_SIGN: Readonly<Record<string, string>> = { '+': '-', '-': '+' }

const flipsSign = (swap: UnarySwap): boolean =>
  Option.exists(
    Option.fromNullOr(swap.replacementOperator),
    (replacement) => replacement === FLIPPED_SIGN[swap.originalOperator],
  )

const signSwap = (swap: UnarySwap): ProbeDecision =>
  Boolean.match(isIn(SIGN_OPERATORS, swap.originalOperator), {
    onFalse: () => unprobed('operator-not-probed'),
    onTrue: () =>
      Boolean.match(flipsSign(swap), {
        onFalse: SHAPE_NOT_RECOGNIZED,
        onTrue: () => probed('unary'),
      }),
  })

const unarySwap = (mutator: ProbedMutatorName, swap: UnarySwap): ProbeDecision =>
  Match.value(mutator).pipe(
    Match.when('UnaryOperator', () => signSwap(swap)),
    Match.when('ArithmeticOperator', SHAPE_NOT_RECOGNIZED),
    Match.when('EqualityOperator', SHAPE_NOT_RECOGNIZED),
    Match.when('ConditionalExpression', SHAPE_NOT_RECOGNIZED),
    Match.exhaustive,
  )

const isComparison = (replacement: ConstantReplacement): boolean =>
  Option.exists(Option.fromNullOr(replacement.comparedOperator), (operator) => isIn(COMPARISON_OPERATORS, operator))

const isLiteral = (operand: ConstantReplacement['left']): boolean => operand === 'literal'

const comparisonConstant = (replacement: ConstantReplacement): ProbeDecision =>
  Boolean.match(isComparison(replacement), {
    onFalse: () => unprobed('not-a-comparison'),
    onTrue: () =>
      Boolean.match([replacement.left, replacement.right].every(isLiteral), {
        onFalse: () => unprobed('operand-not-proven-local'),
        onTrue: () => probed('constant'),
      }),
  })

const constantReplacement = (mutator: ProbedMutatorName, replacement: ConstantReplacement): ProbeDecision =>
  Match.value(mutator).pipe(
    Match.when('ConditionalExpression', () => comparisonConstant(replacement)),
    Match.when('EqualityOperator', () => comparisonConstant(replacement)),
    Match.when('ArithmeticOperator', SHAPE_NOT_RECOGNIZED),
    Match.when('UnaryOperator', SHAPE_NOT_RECOGNIZED),
    Match.exhaustive,
  )

const siteDecision = (mutator: ProbedMutatorName, site: ProbeSite): ProbeDecision =>
  Match.value(site).pipe(
    Match.tagsExhaustive({
      BinarySwap: (swap) => binarySwap(mutator, swap),
      UnarySwap: (swap) => unarySwap(mutator, swap),
      ConstantReplacement: (replacement) => constantReplacement(mutator, replacement),
      UnrecognizedShape: SHAPE_NOT_RECOGNIZED,
    }),
  )

export const assessProbeEligibility = Workflow.make({
  command: AssessProbeEligibilityCommand,
  decision: S.Union([MutantProbed, MutantUnprobed]),
  error: S.Never,
  decide: (command: AssessProbeEligibilityCommand): Result.Result<ProbeDecision, never> =>
    Result.succeed(
      Option.match(Option.liftPredicate(command.mutatorName, S.is(ProbedMutatorName)), {
        onNone: () => unprobed('mutator-not-probed'),
        onSome: (mutator) => siteDecision(mutator, command.site),
      }),
    ),
})
