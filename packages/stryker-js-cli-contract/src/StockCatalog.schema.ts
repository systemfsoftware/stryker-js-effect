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
])
export type StockDefaultName = typeof StockDefaultName.Type

export const StockOptInName = S.Literals(['AtomicUpdateSplit', 'SynchronizationRemoval', 'FinalizerEscape'])
export type StockOptInName = typeof StockOptInName.Type

export const StockMutatorName = S.Union([StockDefaultName, StockOptInName])
export type StockMutatorName = typeof StockMutatorName.Type
