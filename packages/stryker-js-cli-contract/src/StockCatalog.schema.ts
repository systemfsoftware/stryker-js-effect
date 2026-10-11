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
  'RefinementBoundary',
  'RefinementRemoval',
])
export type StockDefaultName = typeof StockDefaultName.Type
