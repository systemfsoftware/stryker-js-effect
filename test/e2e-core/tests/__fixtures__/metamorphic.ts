import { dual } from 'effect/Function'

export const CONTRACT_CLAUSES = {
  DEAD_CODE: 'StockCatalog "ArithmeticOperator" (Dead-Code Invariance: mutants placed regardless of reachability)',
  STATEMENT_COMMUTATIVITY: 'StockCatalog entries (AST Commutativity: independent statement order invariant)',
  BOOLEAN_ARITHMETIC_DUALITY: 'StockCatalog "LogicalOperator" & "BooleanLiteral" (Duality preserves tally mapping)',
  DIRECTIVE_SCOPE:
    'StockCatalog mutator names (Directive Scope Invariance: disable next-line mutes exactly next line, restore re-activates)',
  MUTATION_SUBSUMPTION:
    'StockCatalog "ArithmeticOperator" (Mutation Subsumption bounded: nested-subtree tallies reflect nesting rules)',
} as const

export interface DeadCodeInjectionOptions {
  readonly disabled?: boolean
  readonly deadSnippet?: string
}

const injectDeadCodeDataFirst = (
  source: string,
  options?: DeadCodeInjectionOptions,
): { transformedSource: string; injectedLineOffset: number; injectedMutatorHint: string } => {
  const deadSnippet = options?.deadSnippet ?? 'const _deadVar = 10 + 20;'
  const deadBlock = options?.disabled === true
    ? `\n  // Stryker disable next-line\n  ${deadSnippet}`
    : `\n  ${deadSnippet}`

  const transformedSource = [
    'function _wrapperFn() {',
    '  return 42;',
    deadBlock,
    '}',
    source,
  ].join('\n')

  return {
    transformedSource,
    injectedLineOffset: 3,
    injectedMutatorHint: 'ArithmeticOperator',
  }
}

export const injectDeadCode: {
  (source: string, options?: DeadCodeInjectionOptions): {
    transformedSource: string
    injectedLineOffset: number
    injectedMutatorHint: string
  }
  (options?: DeadCodeInjectionOptions): (source: string) => {
    transformedSource: string
    injectedLineOffset: number
    injectedMutatorHint: string
  }
} = dual((args: IArguments): boolean => typeof args[0] === 'string', injectDeadCodeDataFirst)

export function shuffleIndependentStatements(statements: readonly string[]): {
  shuffled: readonly string[]
  isReordered: boolean
} {
  if (statements.length <= 1) {
    return { shuffled: [...statements], isReordered: false }
  }

  const copy = [...statements]
  const first = copy[0]
  copy[0] = copy[1]
  copy[1] = first

  return {
    shuffled: copy,
    isReordered: copy[0] !== statements[0],
  }
}

export type DualityKind = 'and-to-demorgan' | 'or-to-demorgan'

const dualizeBooleanArithmeticDataFirst = (
  leftIdent: string,
  op: '&&' | '||',
  rightIdent: string,
): {
  originalExpr: string
  dualExpr: string
  originalLogicalCount: number
  dualLogicalCount: number
  dualPrefixBangCount: number
} => {
  if (op === '&&') {
    return {
      originalExpr: `${leftIdent} && ${rightIdent}`,
      dualExpr: `!(!${leftIdent} || !${rightIdent})`,
      originalLogicalCount: 1,
      dualLogicalCount: 1,
      dualPrefixBangCount: 3,
    }
  }

  return {
    originalExpr: `${leftIdent} || ${rightIdent}`,
    dualExpr: `!(!${leftIdent} && !${rightIdent})`,
    originalLogicalCount: 1,
    dualLogicalCount: 1,
    dualPrefixBangCount: 3,
  }
}

export const dualizeBooleanArithmetic: {
  (leftIdent: string, op: '&&' | '||', rightIdent: string): {
    originalExpr: string
    dualExpr: string
    originalLogicalCount: number
    dualLogicalCount: number
    dualPrefixBangCount: number
  }
  (op: '&&' | '||', rightIdent: string): (leftIdent: string) => {
    originalExpr: string
    dualExpr: string
    originalLogicalCount: number
    dualLogicalCount: number
    dualPrefixBangCount: number
  }
} = dual(3, dualizeBooleanArithmeticDataFirst)

const injectDisableNextLineDataFirst = (
  targetLineText: string,
  surroundingPrefix: readonly string[] = [],
  surroundingSuffix: readonly string[] = [],
  withRestoreAfter = false,
): string => {
  const lines: string[] = [...surroundingPrefix]
  lines.push('// Stryker disable next-line')
  lines.push(targetLineText)
  if (withRestoreAfter) {
    lines.push('// Stryker restore')
  }
  lines.push(...surroundingSuffix)
  return lines.join('\n')
}

export const injectDisableNextLine: {
  (
    targetLineText: string,
    surroundingPrefix?: readonly string[],
    surroundingSuffix?: readonly string[],
    withRestoreAfter?: boolean,
  ): string
  (
    surroundingPrefix?: readonly string[],
    surroundingSuffix?: readonly string[],
    withRestoreAfter?: boolean,
  ): (targetLineText: string) => string
} = dual((args: IArguments): boolean => typeof args[0] === 'string', injectDisableNextLineDataFirst)

const nestSubsumingExpressionsDataFirst = (
  innerLeft: { left: string | number; op: string; right: string | number },
  outerOp: string,
  innerRight: { left: string | number; op: string; right: string | number },
): {
  sourceCode: string
  innerCount: number
  outerCount: number
  totalArithmeticPlacements: number
} => {
  const innerLeftText = `(${innerLeft.left} ${innerLeft.op} ${innerLeft.right})`
  const innerRightText = `(${innerRight.left} ${innerRight.op} ${innerRight.right})`
  const sourceCode = `const _nested = ${innerLeftText} ${outerOp} ${innerRightText};`

  return {
    sourceCode,
    innerCount: 2,
    outerCount: 1,
    totalArithmeticPlacements: 3,
  }
}

export const nestSubsumingExpressions: {
  (
    innerLeft: { left: string | number; op: string; right: string | number },
    outerOp: string,
    innerRight: { left: string | number; op: string; right: string | number },
  ): { sourceCode: string; innerCount: number; outerCount: number; totalArithmeticPlacements: number }
  (
    outerOp: string,
    innerRight: { left: string | number; op: string; right: string | number },
  ): (innerLeft: { left: string | number; op: string; right: string | number }) => {
    sourceCode: string
    innerCount: number
    outerCount: number
    totalArithmeticPlacements: number
  }
} = dual(3, nestSubsumingExpressionsDataFirst)
