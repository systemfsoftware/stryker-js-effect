import * as S from 'effect/Schema'

export const StockDefaultName = S.Literals([
  'ArithmeticOperator',
  'ArrayDeclaration',
  'ArrowFunction',
  'AssignmentOperator',
  'BlockStatement',
  'BooleanLiteral',
  'ConditionalExpression',
  'EqualityOperator',
  'LogicalOperator',
  'MethodExpression',
  'ObjectLiteral',
  'OptionalChaining',
  'Regex',
  'StringLiteral',
  'UnaryOperator',
  'UpdateOperator',
  'AtomicUpdateSplit',
  'SynchronizationRemoval',
  'FinalizerEscape',
  'RecoveryRemoval',
  'FailureToDefect',
])
export type StockDefaultName = typeof StockDefaultName.Type
