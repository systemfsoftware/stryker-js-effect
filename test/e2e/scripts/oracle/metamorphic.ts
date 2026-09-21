export const CONTRACT_CLAUSES = {
  DEAD_CODE: 'mutator-contract.md § R1 (Dead-Code Invariance: mutants placed regardless of reachability)',
  STATEMENT_COMMUTATIVITY: 'mutator-contract.md § R1 (AST Commutativity: independent statement order invariant)',
  BOOLEAN_ARITHMETIC_DUALITY:
    'mutator-contract.md § LogicalOperator & § BooleanLiteral (Duality preserves tally mapping)',
  DIRECTIVE_SCOPE:
    'mutator-contract.md § R1 (Directive Scope Invariance: disable next-line mutes exactly next line, restore re-activates)',
  MUTATION_SUBSUMPTION:
    'mutator-contract.md § R1 (Mutation Subsumption bounded: nested-subtree tallies reflect nesting rules)',
} as const

export interface DeadCodeInjectionOptions {
  readonly disabled?: boolean
  readonly deadSnippet?: string
}

export function injectDeadCode(
  source: string,
  options?: DeadCodeInjectionOptions,
): { transformedSource: string; injectedLineOffset: number; injectedMutatorHint: string } {
  const deadSnippet = options?.deadSnippet ?? 'const _deadVar = 10 + 20;'
  const deadBlock = options?.disabled
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

export function shuffleIndependentStatements(statements: readonly string[]): {
  shuffled: readonly string[]
  isReordered: boolean
} {
  if (statements.length <= 1) {
    return { shuffled: [...statements], isReordered: false }
  }

  const copy = [...statements]
  const first = copy[0]!
  copy[0] = copy[1]!
  copy[1] = first

  return {
    shuffled: copy,
    isReordered: copy[0] !== statements[0],
  }
}

export type DualityKind = 'and-to-demorgan' | 'or-to-demorgan'

export function dualizeBooleanArithmetic(
  leftIdent: string,
  op: '&&' | '||',
  rightIdent: string,
): {
  originalExpr: string
  dualExpr: string
  originalLogicalCount: number
  dualLogicalCount: number
  dualPrefixBangCount: number
} {
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

export function injectDisableNextLine(
  targetLineText: string,
  surroundingPrefix: readonly string[] = [],
  surroundingSuffix: readonly string[] = [],
  withRestoreAfter = false,
): string {
  const lines: string[] = [...surroundingPrefix]
  lines.push('// Stryker disable next-line')
  lines.push(targetLineText)
  if (withRestoreAfter) {
    lines.push('// Stryker restore')
  }
  lines.push(...surroundingSuffix)
  return lines.join('\n')
}

export function nestSubsumingExpressions(
  innerLeft: { left: string | number; op: string; right: string | number },
  outerOp: string,
  innerRight: { left: string | number; op: string; right: string | number },
): {
  sourceCode: string
  innerCount: number
  outerCount: number
  totalArithmeticPlacements: number
} {
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
