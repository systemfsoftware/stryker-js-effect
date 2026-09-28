/**
 * The sufficient sets of non-redundant relational-operator mutations.
 *
 * Source: René Just and Franz Schweiggert, "Higher Accuracy and Lower Run Time:
 * Efficient Mutation Analysis Using Non-Redundant Mutation Operators", Journal
 * of Software Testing, Verification and Reliability 24(5), 2014, Table III
 * (https://homes.cs.washington.edu/~rjust/publ/non_redundant_mutants_jstvr_2014.pdf).
 *
 * The paper groups every input tuple into the three intervals `a < b`,
 * `a == b`, and `a > b`. For each relational operator exactly one
 * minimal-distance mutation covers each interval, and those three mutations
 * subsume every other relational replacement. Each row below lists the two
 * replacement operators and the boolean the whole comparison collapses to. The
 * sets assume numeric operands without `NaN`; `mutantSetPolicy: 'full'`
 * restores every variant.
 */
export const RELATIONAL_OPERATORS = ['<', '<=', '>', '>='] as const
export type RelationalOperator = typeof RELATIONAL_OPERATORS[number]

export const COMPARISON_OPERATORS = ['<', '<=', '>', '>=', '==', '!='] as const
export type ComparisonOperator = typeof COMPARISON_OPERATORS[number]

export const isRelationalOperator = (operator: string): operator is RelationalOperator =>
  RELATIONAL_OPERATORS.some((relational) => relational === operator)

export const isComparisonOperator = (operator: string): operator is ComparisonOperator =>
  COMPARISON_OPERATORS.some((comparison) => comparison === operator)

export interface SufficientRelationalSet {
  readonly replacements: readonly [ComparisonOperator, ComparisonOperator]
  readonly literal: boolean
}

export const SUFFICIENT_RELATIONAL_SETS: Readonly<Record<RelationalOperator, SufficientRelationalSet>> = {
  '<': { replacements: ['<=', '!='], literal: false },
  '<=': { replacements: ['<', '=='], literal: true },
  '>': { replacements: ['>=', '!='], literal: false },
  '>=': { replacements: ['>', '=='], literal: true },
}
